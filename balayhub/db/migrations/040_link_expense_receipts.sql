-- Expense receipts were stored as files but never linked, so owner statements and the owner portal showed no Receipt link.
-- Link each unlinked, non-voided expense to its newest receipt file. Forward-only; the upload route now keeps the link up to date.
-- Rollback: not needed (the link is derived data); UPDATE expenses SET receipt_file_id = NULL would undo it.

UPDATE expenses e
   SET receipt_file_id = f.file_id
  FROM (SELECT DISTINCT ON (organization_id, related_record_id) organization_id, related_record_id, file_id
          FROM files
         WHERE related_record_type = 'expense'
         ORDER BY organization_id, related_record_id, uploaded_at DESC, file_id) f
 WHERE f.related_record_id = e.expense_id
   AND f.organization_id = e.organization_id
   AND e.receipt_file_id IS NULL
   AND e.voided_at IS NULL;
