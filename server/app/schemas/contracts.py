from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
NonNegativeInt = Annotated[int, Field(ge=0)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class BBox(StrictModel):
    x: float
    y: float
    width: float = Field(ge=0)
    height: float = Field(ge=0)


class Viewport(StrictModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class PageElement(StrictModel):
    id: str = Field(pattern=r"^el_[A-Za-z0-9_-]+$")
    role: str = Field(min_length=1, max_length=64)
    tag: str = Field(min_length=1, max_length=32)
    text: str | None = Field(default=None, max_length=2_000)
    label: str | None = Field(default=None, max_length=500)
    input_type: str | None = Field(default=None, max_length=32)
    bbox: BBox
    visible: bool
    enabled: bool
    selected: bool | None
    value_present: bool
    options: list[str] = Field(max_length=500)
    selected_option: str | None = Field(default=None, min_length=1, max_length=500)
    control_value: str | None = Field(default=None, min_length=1, max_length=500)
    dom_index: int = Field(default=0, ge=0)
    sources: list[Literal["DOM", "VISION", "OCR"]] | None = Field(
        default=None, min_length=1, max_length=3
    )


VisualRegionKind = Literal["CANVAS", "IMAGE", "PDF", "VISUAL_CONTROL", "UNKNOWN"]


class VisualRegion(StrictModel):
    id: str = Field(pattern=r"^region_[A-Za-z0-9_-]+$")
    kind: VisualRegionKind
    bbox: BBox
    requires_analysis: bool


class PageObservation(StrictModel):
    snapshot_id: str = Field(pattern=r"^snap_[A-Za-z0-9_-]+$")
    origin: HttpUrl
    url: HttpUrl
    viewport: Viewport
    elements: list[PageElement] = Field(max_length=2_000)
    visual_regions: list[VisualRegion] = Field(max_length=200)
    timestamp: int = Field(ge=0)


SensitiveEntityType = Literal[
    "EMAIL",
    "PHONE",
    "PAN",
    "GSTIN",
    "IFSC",
    "UPI_ID",
    "PAYMENT_CARD",
    "OTP",
    "PASSWORD",
    "AADHAAR_LIKE",
    "ACCOUNT_ID",
    "PERSON_NAME",
    "ADDRESS",
    "MEDICAL",
    "FACE",
    "PRIVATE_DOCUMENT",
    "OTHER",
]


class SensitiveEntity(StrictModel):
    entity_id: str = Field(pattern=r"^pii_[A-Za-z0-9_-]+$")
    type: SensitiveEntityType
    source: Literal["DOM", "OCR", "VISION", "INPUT_METADATA"]
    confidence: float = Field(ge=0, le=1)
    element_id: str | None = Field(default=None, pattern=r"^el_[A-Za-z0-9_-]+$")
    region_id: str | None = Field(default=None, pattern=r"^region_[A-Za-z0-9_-]+$")


class PolicyDecision(StrictModel):
    entity_id: str = Field(pattern=r"^pii_[A-Za-z0-9_-]+$")
    decision: Literal["KEEP", "ABSTRACT", "LOCAL_HANDLE", "SANITIZED_CROP", "DROP", "ASK"]
    replacement: str | None = Field(default=None, max_length=128)


class SanitizedElement(StrictModel):
    id: str = Field(pattern=r"^el_[A-Za-z0-9_-]+$")
    role: str = Field(min_length=1, max_length=64)
    text: str | None = Field(default=None, max_length=2_000)
    label: str | None = Field(default=None, max_length=500)
    input_type: str | None = Field(default=None, max_length=32)
    value_handle: str | None = Field(default=None, pattern=r"^LOCAL_[A-Z0-9_]+$")
    enabled: bool
    selected: bool | None
    value_present: bool
    options: list[str] = Field(max_length=500)
    selected_option: str | None = Field(default=None, min_length=1, max_length=500)
    control_value: str | None = Field(default=None, min_length=1, max_length=500)
    dom_index: int = Field(default=0, ge=0)
    bbox: BBox | None = None
    sources: list[Literal["DOM", "VISION", "OCR"]] | None = Field(
        default=None, min_length=1, max_length=3
    )


class SafeVisualCrop(StrictModel):
    id: str = Field(pattern=r"^crop_[A-Za-z0-9_-]+$")
    mime_type: Literal["image/png", "image/jpeg"]
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    width: int = Field(gt=0, le=4_096)
    height: int = Field(gt=0, le=4_096)
    data_base64: str = Field(max_length=2_000_000)
    redaction_verified: Literal[True]


class SanitizedContext(StrictModel):
    task: str = Field(min_length=1, max_length=4_000)
    origin: HttpUrl
    snapshot_id: str = Field(pattern=r"^snap_[A-Za-z0-9_-]+$")
    elements: list[SanitizedElement] = Field(max_length=2_000)
    safe_visual_crops: list[SafeVisualCrop] = Field(max_length=8)
    privacy_summary: dict[SensitiveEntityType, NonNegativeInt]


class ActionBase(StrictModel):
    action_id: str = Field(pattern=r"^act_[A-Za-z0-9_-]+$")
    snapshot_id: str = Field(pattern=r"^snap_[A-Za-z0-9_-]+$")
    reason: str = Field(min_length=1, max_length=1_000)


class ClickAction(ActionBase):
    type: Literal["CLICK"]
    element_id: str = Field(pattern=r"^el_[A-Za-z0-9_-]+$")


class TypeHandleAction(ActionBase):
    type: Literal["TYPE_HANDLE"]
    element_id: str = Field(pattern=r"^el_[A-Za-z0-9_-]+$")
    handle: str = Field(pattern=r"^LOCAL_[A-Z0-9_]+$")


class SelectAction(ActionBase):
    type: Literal["SELECT"]
    element_id: str = Field(pattern=r"^el_[A-Za-z0-9_-]+$")
    option: str = Field(min_length=1, max_length=500)


class ScrollAction(ActionBase):
    type: Literal["SCROLL"]
    direction: Literal["UP", "DOWN"]
    amount: int = Field(ge=1, le=1_500)


class AskUserAction(ActionBase):
    type: Literal["ASK_USER"]
    question: str = Field(min_length=1, max_length=1_000)


class FinishAction(ActionBase):
    type: Literal["FINISH"]
    summary: str = Field(min_length=1, max_length=2_000)


AgentAction = Annotated[
    ClickAction | TypeHandleAction | SelectAction | ScrollAction | AskUserAction | FinishAction,
    Field(discriminator="type"),
]

AgentState = Literal["OBSERVE", "PLAN", "EXECUTE", "VERIFY", "COMPLETE", "FAILED"]


class AgentStartResponse(StrictModel):
    session_id: str = Field(pattern=UUID_PATTERN)
    state: AgentState
    action: AgentAction


class AgentStepRequest(StrictModel):
    session_id: str = Field(pattern=UUID_PATTERN)
    context: SanitizedContext


ErrorCode = Literal[
    "PERCEPTION_FAILED",
    "PRIVACY_SCAN_FAILED",
    "REDACTION_FAILED",
    "PRIVACY_ASSERTION_FAILED",
    "NETWORK_FAILED",
    "MODEL_FAILED",
    "INVALID_AGENT_ACTION",
    "STALE_SNAPSHOT",
    "ELEMENT_NOT_FOUND",
    "CONFIRMATION_REQUIRED",
    "ACTION_FAILED",
    "VERIFICATION_FAILED",
]


class VerificationResult(StrictModel):
    action_id: str = Field(pattern=r"^act_[A-Za-z0-9_-]+$")
    success: bool
    page_changed: bool
    new_snapshot_required: bool
    error: ErrorCode | None = None


class VerificationRequest(StrictModel):
    session_id: str = Field(pattern=UUID_PATTERN)
    result: VerificationResult


class VerificationResponse(StrictModel):
    session_id: str = Field(pattern=UUID_PATTERN)
    state: AgentState
    accepted: bool
