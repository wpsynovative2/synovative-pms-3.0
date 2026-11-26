-- 0019_invoice_cheque_ready.sql
--
-- Payment follow-ups (0011): a call can end with the client's cheque ready to
-- be picked up. "Cheque ready" joins the outcomes, and
-- invoice_calls.cheque_collect_on holds the day it is to be collected. A
-- cheque-ready call must name that day.
--
-- Mirrors INVOICE_CALL_OUTCOMES and InvoiceCall.chequeCollectOn in
-- lib/types.ts, and the Log a call form in components/invoice/follow-ups.tsx.

alter table invoice_calls add column cheque_collect_on date;

alter table invoice_calls drop constraint invoice_calls_outcome_check;
alter table invoice_calls add constraint invoice_calls_outcome_check check (outcome = any (array[
  'Promised to pay', 'Part payment promised', 'Cheque ready', 'Says already paid',
  'Needs documents', 'Disputed', 'Call back later', 'No answer', 'Other'
]));

alter table invoice_calls add constraint invoice_calls_cheque_collect_check
  check (outcome <> 'Cheque ready' or cheque_collect_on is not null);
