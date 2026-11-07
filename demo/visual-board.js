// Authored before the first evaluation run. Labels derive from these fixture
// values, never from model output. This is a synthetic test, not a held-out set.
const scenarios = [
  { values: [480, 215, 360], unit: 'INR', subject: 'prices', direction: 'lowest', layout: 'rows' },
  { values: [135, 425, 280], unit: 'INR', subject: 'prices', direction: 'lowest', layout: 'columns' },
  { values: [795, 645, 525], unit: 'INR', subject: 'prices', direction: 'lowest', layout: 'rows' },
  { values: [42, 76, 58], unit: 'minutes', subject: 'durations', direction: 'shortest', layout: 'columns' },
  { values: [91, 63, 78], unit: 'minutes', subject: 'durations', direction: 'shortest', layout: 'rows' },
  { values: [86, 94, 57], unit: 'minutes', subject: 'durations', direction: 'shortest', layout: 'columns' },
];
const index = Number(new window.URL(window.location.href).searchParams.get('case') ?? '3');
const scenario = scenarios[Number.isInteger(index) && index >= 0 && index < scenarios.length ? index : 0];
const canvas = document.querySelector('#board');
const drawing = canvas.getContext('2d');
drawing.fillStyle = '#ffffff';
drawing.fillRect(0, 0, canvas.width, canvas.height);
drawing.fillStyle = '#123e30';
drawing.font = 'bold 28px Arial';
drawing.fillText(scenario.subject === 'prices' ? 'Product prices' : 'Delivery durations', 24, 42);
drawing.font = '30px Arial';
scenario.values.forEach((value, i) => {
  const label = `Option ${'ABC'[i]}`;
  if (scenario.layout === 'rows') drawing.fillText(`${label}: ${value} ${scenario.unit}`, 24, 104 + i * 74);
  else {
    drawing.fillText(label, 24 + i * 260, 136);
    drawing.fillText(`${value} ${scenario.unit}`, 24 + i * 260, 196);
  }
});
document.querySelector('#task').textContent = `Compare the ${scenario.subject} shown on the visual board. Click the option with the ${scenario.direction} ${scenario.subject === 'prices' ? 'price' : 'duration'}, then stop.`;
document.querySelectorAll('#choices button').forEach((button, i) => button.addEventListener('click', () => {
  document.querySelector('#outcome').textContent = `Selected option ${'ABC'[i]}. Selection complete.`;
  document.querySelectorAll('#choices button').forEach((choice) => { choice.disabled = true; });
}));
