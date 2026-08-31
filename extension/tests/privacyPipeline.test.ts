import type { PageObservation } from '@contextshield/shared';
import { describe, expect, it } from 'vitest';

import { LocalPrivacyPipeline, PrivacyPipelineUnavailableError } from '../lib/privacy/pipeline';
import type { ContextualPiiScanner } from '../lib/privacy/rampartScanner';
import { SecretVault } from '../lib/vault/secretVault';

function observation(): PageObservation {
  return {
    snapshot_id: 'snap_test_1',
    origin: 'https://example.com',
    url: 'https://example.com/form',
    viewport: { width: 1280, height: 720 },
    elements: [
      {
        id: 'el_1',
        role: 'textbox',
        tag: 'input',
        text: null,
        label: 'Email',
        input_type: 'email',
        bbox: { x: 10, y: 10, width: 200, height: 40 },
        visible: true,
        enabled: true,
        selected: null,
        value_present: false,
        options: [],
        selected_option: null,
        control_value: null,
        dom_index: 0,
      },
      {
        id: 'el_2',
        role: 'p',
        tag: 'p',
        text: 'Contact private@example.com about patient Jane Doe',
        label: null,
        input_type: null,
        bbox: { x: 10, y: 60, width: 500, height: 30 },
        visible: true,
        enabled: true,
        selected: null,
        value_present: false,
        options: [],
        selected_option: null,
        control_value: null,
        dom_index: 1,
      },
    ],
    visual_regions: [],
    timestamp: 1,
  };
}

describe('local privacy pipeline', () => {
  it('replaces task secrets with local handles and never places values in context', async () => {
    const vault = new SecretVault();
    const pipeline = new LocalPrivacyPipeline(vault);
    const localEmailHandle = vault.store('EMAIL', 'owner@example.com');
    const result = await pipeline.sanitize(
      { observation: observation(), privateValues: [], visualHints: [], ocrHints: [], safeVisualCrops: [], fingerprint: 'fp_1' },
      'Use owner@example.com and continue',
    );

    expect(result.context.task).toContain(localEmailHandle);
    expect(result.context.elements[0]?.value_handle).toBe(localEmailHandle);
    expect(result.serverPreview).not.toContain('owner@example.com');
    expect(result.serverPreview).not.toContain('private@example.com');
  });

  it('adds contextual worker protection after deterministic redaction', async () => {
    const scanner: ContextualPiiScanner = {
      protectMany: (texts) =>
        Promise.resolve(texts.map((text) => ({
          text: text.replace('Jane Doe', '[GIVEN_NAME_1] [SURNAME_1]'),
          placeholders: text.includes('Jane Doe')
            ? ['[GIVEN_NAME_1]', '[SURNAME_1]']
            : [],
        }))),
      terminate: () => undefined,
    };
    const result = await new LocalPrivacyPipeline(new SecretVault(), scanner).sanitize(
      { observation: observation(), privateValues: [], visualHints: [], ocrHints: [], safeVisualCrops: [], fingerprint: 'fp_1' },
      'Continue',
    );
    expect(result.context.elements[1]?.text).toContain('[GIVEN_NAME_1] [SURNAME_1]');
    expect(result.context.privacy_summary.PERSON_NAME).toBe(2);
  });

  it('fails closed when contextual inference fails', async () => {
    const scanner: ContextualPiiScanner = {
      protectMany: () => Promise.reject(new Error('worker crashed')),
      terminate: () => undefined,
    };
    await expect(
      new LocalPrivacyPipeline(new SecretVault(), scanner).sanitize(
        { observation: observation(), privateValues: [], visualHints: [], ocrHints: [], safeVisualCrops: [], fingerprint: 'fp_1' },
        'Continue',
      ),
    ).rejects.toBeInstanceOf(PrivacyPipelineUnavailableError);
  });

  it('turns contextual task placeholders into resolvable local handles', async () => {
    const vault = new SecretVault();
    const scanner: ContextualPiiScanner = {
      protectMany: (texts) => Promise.resolve(texts.map((text) => {
        if (text === 'Greet Arindam') {
          return {
            text: 'Greet [GIVEN_NAME_1]',
            placeholders: ['[GIVEN_NAME_1]'],
            localValues: [{ placeholder: '[GIVEN_NAME_1]', value: 'Arindam' }],
          };
        }
        return { text, placeholders: [], localValues: [] };
      })),
      terminate: () => undefined,
    };

    const result = await new LocalPrivacyPipeline(vault, scanner).sanitize(
      { observation: observation(), privateValues: [], visualHints: [], ocrHints: [], safeVisualCrops: [], fingerprint: 'fp_1' },
      'Greet Arindam',
    );

    expect(result.context.task).toBe('Greet LOCAL_GIVEN_NAME_1');
    expect(result.serverPreview).not.toContain('Arindam');
    expect(vault.resolve('LOCAL_GIVEN_NAME_1')).toBe('Arindam');
  });

  it('exposes task-supplied local handles only to their matching form fields', async () => {
    const vault = new SecretVault();
    const page = observation();
    const fields = [
      ['el_first', 'First Name'],
      ['el_last', 'Last Name'],
      ['el_email', 'Email'],
      ['el_mobile', 'Mobile Number'],
      ['el_address', 'Current Address'],
    ] as const;
    page.elements = fields.map(([id, label], domIndex) => ({
      id,
      role: 'textbox',
      tag: label === 'Current Address' ? 'textarea' : 'input',
      text: null,
      label,
      input_type: 'text',
      bbox: { x: 10, y: 10 + domIndex * 40, width: 200, height: 30 },
      visible: true,
      enabled: true,
      selected: null,
      value_present: false,
      options: [],
      selected_option: null,
      control_value: null,
      dom_index: domIndex,
    }));

    const result = await new LocalPrivacyPipeline(vault).sanitize(
      { observation: page, privateValues: [], visualHints: [], ocrHints: [], safeVisualCrops: [], fingerprint: 'fp_fields' },
      'Fill first name Arindam, last name Test, email owner@example.com, mobile 9876543210, and address Kolkata. Do not submit it.',
    );

    expect(result.context.elements.map((element) => element.value_handle)).toEqual([
      'LOCAL_GIVEN_NAME_1',
      'LOCAL_SURNAME_1',
      'LOCAL_EMAIL_1',
      'LOCAL_PHONE_1',
      'LOCAL_ADDRESS_1',
    ]);
    expect(result.serverPreview).not.toContain('Arindam');
    expect(result.serverPreview).not.toContain('owner@example.com');
    expect(result.serverPreview).not.toContain('Kolkata');
  });

  it('keeps short generic control choices usable while still protecting recipient names', async () => {
    const page = observation();
    page.elements.push(
      {
        id: 'el_3',
        role: 'combobox',
        tag: 'select',
        text: null,
        label: null,
        input_type: 'select',
        bbox: { x: 10, y: 100, width: 200, height: 40 },
        visible: true,
        enabled: true,
        selected: null,
        value_present: true,
        options: ['JAVA', 'Python'],
        selected_option: 'JAVA',
        control_value: null,
        dom_index: 2,
      },
      {
        id: 'el_4',
        role: 'checkbox',
        tag: 'input',
        text: null,
        label: 'Option 2',
        input_type: 'checkbox',
        bbox: { x: 10, y: 150, width: 20, height: 20 },
        visible: true,
        enabled: true,
        selected: false,
        value_present: false,
        options: [],
        selected_option: null,
        control_value: 'option-2',
        dom_index: 3,
      },
      {
        id: 'el_5',
        role: 'combobox',
        tag: 'select',
        text: null,
        label: 'Recipient name',
        input_type: 'select',
        bbox: { x: 10, y: 180, width: 200, height: 40 },
        visible: true,
        enabled: true,
        selected: null,
        value_present: true,
        options: ['Arindam'],
        selected_option: 'Arindam',
        control_value: null,
        dom_index: 4,
      },
      {
        id: 'el_6',
        role: 'checkbox',
        tag: 'input',
        text: null,
        label: 'checkbox 1',
        input_type: 'checkbox',
        bbox: { x: 10, y: 230, width: 20, height: 20 },
        visible: true,
        enabled: true,
        selected: false,
        value_present: false,
        options: [],
        selected_option: null,
        control_value: null,
        dom_index: 5,
      },
      {
        id: 'el_7',
        role: 'checkbox',
        tag: 'input',
        text: null,
        label: 'checkbox 2',
        input_type: 'checkbox',
        bbox: { x: 10, y: 260, width: 20, height: 20 },
        visible: true,
        enabled: true,
        selected: true,
        value_present: false,
        options: [],
        selected_option: null,
        control_value: null,
        dom_index: 6,
      },
    );
    const scanner: ContextualPiiScanner = {
      protectMany: (texts) => Promise.resolve(texts.map((text) => {
        if (['JAVA', 'Python', 'option-2'].includes(text)) {
          return { text: '[GIVEN_NAME_1]', placeholders: ['[GIVEN_NAME_1]'] };
        }
        if (text === 'Option 2') {
          return { text: '[SECONDARY_ADDRESS_1] 1', placeholders: ['[SECONDARY_ADDRESS_1]'] };
        }
        if (text === 'Arindam') {
          return { text: '[GIVEN_NAME_2]', placeholders: ['[GIVEN_NAME_2]'] };
        }
        if (text === 'checkbox 1' || text === 'checkbox 2') {
          return { text: '[STREET_NAME_1] [BUILDING_NUMBER_1]', placeholders: ['[STREET_NAME_1]', '[BUILDING_NUMBER_1]'] };
        }
        return { text, placeholders: [] };
      })),
      terminate: () => undefined,
    };

    const result = await new LocalPrivacyPipeline(new SecretVault(), scanner).sanitize(
      { observation: page, privateValues: [], visualHints: [], ocrHints: [], safeVisualCrops: [], fingerprint: 'fp_1' },
      'Select Python, Option 2, and continue',
    );

    expect(result.context.elements[2]).toMatchObject({
      options: ['JAVA', 'Python'],
      selected_option: 'JAVA',
    });
    expect(result.context.elements[3]).toMatchObject({
      label: 'Option 2',
      control_value: 'option-2',
    });
    expect(result.context.elements[4]?.options[0]).toBe('[GIVEN_NAME_2]');
    expect(result.context.elements[5]?.label).toBe('checkbox 1');
    expect(result.context.elements[6]?.label).toBe('checkbox 2');
  });
});
