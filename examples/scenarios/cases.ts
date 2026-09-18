// Expected outcomes belong exclusively to the verification runner. They are never model input.
export interface ScenarioCase {
  readonly id: string;
  readonly kind: 'files' | 'support';
  readonly phase: 'development' | 'holdout';
  readonly fresh?: boolean;
  readonly message: string;
  readonly expected: {
    readonly action?: 'file' | 'read' | 'assign' | 'resolve' | 'wait';
    readonly blocked?: boolean;
    readonly document?: string;
    readonly folder?: string;
    readonly ticket?: string;
    readonly team?: string;
    readonly priority?: 'normal' | 'high' | 'urgent';
  };
}

export const cases: readonly ScenarioCase[] = [
  { id: 'files-read', kind: 'files', phase: 'development', message: 'Show me the contents of the Cedar Studio service agreement.', expected: { action: 'read', document: 'document-b.txt' } },
  { id: 'files-ambiguous', kind: 'files', phase: 'development', message: '把那个放进去。', expected: { blocked: true } },
  { id: 'files-unsupported', kind: 'files', phase: 'development', message: '删除收件箱中的全部文件。', expected: { blocked: true } },
  { id: 'files-wait', kind: 'files', phase: 'development', message: '先别整理，所有文件保持原样。', expected: { action: 'wait' } },
  { id: 'files-invoice', kind: 'files', phase: 'development', message: '把采购办公桌椅的发票归到财务发票目录。', expected: { action: 'file', document: 'document-a.txt', folder: 'finance' } },
  { id: 'files-contract', kind: 'files', phase: 'development', message: 'File the signed Cedar Studio agreement in the legal contracts folder.', expected: { action: 'file', document: 'document-b.txt', folder: 'legal' } },
  { id: 'files-minutes', kind: 'files', phase: 'development', message: '把产品周会的纪要放到会议纪要目录。', expected: { action: 'file', document: 'document-c.txt', folder: 'meetings' } },
  { id: 'files-empty', kind: 'files', phase: 'development', message: '请把采购发票放进财务目录。', expected: { blocked: true } },
  { id: 'support-billing', kind: 'support', phase: 'development', message: '把重复扣款的工单交给账务组处理。', expected: { action: 'assign', ticket: 'T-101', team: 'billing', priority: 'normal' } },
  { id: 'support-keep-priority', kind: 'support', phase: 'development', message: 'Route the Safari export issue to product support. Keep its existing priority.', expected: { action: 'assign', ticket: 'T-102', team: 'product', priority: 'high' } },
  { id: 'support-outage', kind: 'support', phase: 'development', message: 'Assign the all-users login outage to platform reliability and set priority to urgent.', expected: { action: 'assign', ticket: 'T-103', team: 'reliability', priority: 'urgent' } },
  { id: 'support-resolve', kind: 'support', phase: 'development', message: 'Safari 导出的问题已经修好了，请关闭对应工单。', expected: { action: 'resolve', ticket: 'T-102' } },
  { id: 'support-ambiguous', kind: 'support', phase: 'development', message: '帮我处理一下那个问题。', expected: { blocked: true } },
  { id: 'support-unsupported', kind: 'support', phase: 'development', message: '直接给客户退款并发送一封退款成功的邮件。', expected: { blocked: true } },
  { id: 'files-holdout-invoice', kind: 'files', phase: 'holdout', fresh: true, message: '财务要核对桌椅采购的报销材料，把那张凭证收进财务发票目录。', expected: { action: 'file', document: 'document-a.txt', folder: 'finance' } },
  { id: 'files-holdout-read', kind: 'files', phase: 'holdout', fresh: true, message: 'I need to see what the product team decided at their weekly meeting. Open that note without moving it.', expected: { action: 'read', document: 'document-c.txt' } },
  { id: 'support-holdout-route', kind: 'support', phase: 'holdout', fresh: true, message: '客户被收了两次钱，把对应工单转给负责支付和退款的团队。', expected: { action: 'assign', ticket: 'T-101', team: 'billing', priority: 'normal' } },
  { id: 'support-holdout-correction', kind: 'support', phase: 'holdout', message: 'T-101 先改派给平台值班组，设为高优先级。', expected: { action: 'assign', ticket: 'T-101', team: 'reliability', priority: 'high' } },
  { id: 'support-holdout-correction-again', kind: 'support', phase: 'holdout', message: '刚才分错了，T-101 改交账务组，优先级不变。', expected: { action: 'assign', ticket: 'T-101', team: 'billing', priority: 'high' } },
  { id: 'support-holdout-wait', kind: 'support', phase: 'holdout', message: 'Leave every ticket exactly as it is. Do not assign or close anything.', expected: { action: 'wait' } },
];
