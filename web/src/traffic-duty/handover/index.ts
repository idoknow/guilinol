export {
  DUPLICATE_CITATION_MESSAGE,
  HANDOVER_MAX_DISTANCE_M,
  HANDOVER_ORDERED_STAGES,
  HANDOVER_STAGE_FULL_LABELS,
  HANDOVER_STAGE_LABELS,
  type CitationNetSyncPayload,
  type CitationRecord,
  type CloseupSnapshot,
  type FineLineItem,
  type HandoverAttemptResult,
  type HandoverStage,
  type HandoverWorkflowOptions,
  type HandoverWorkflowSnapshot,
  type SerializedCitationLedger,
  type TypingProgressSnapshot,
} from './types.ts'

export {
  createCitationLedger,
  sharedCitationLedger,
  type CitationLedger,
  type CiteCheckResult,
} from './ledger.ts'

export {
  animateViolatorReachPose,
  attachReceiptToViolator,
  buildSimulatedQrPayload,
  createReceiptSlipModel,
  formatReceiptItemLines,
  generateSimulatedQrMatrix,
  getViolatorHeldReceipt,
  isViolatorHoldingReceipt,
  paintReceiptPaperCanvas,
  resolveHandMountNode,
  selectNearestViolatorHand,
  type HeldReceiptAttachment,
  type MountViolatorReceiptOptions,
  type ReceiptPaperPrintSpec,
  type ReceiptSlipModel,
} from './receipt-model.ts'

export {
  createHandoverCloseupController,
  type HandoverCloseupController,
} from './camera-closeup.ts'

export {
  startHandoverWorkflow,
  type CreateHandoverWorkflowDeps,
  type HandoverWorkflowHandle,
} from './workflow.ts'
