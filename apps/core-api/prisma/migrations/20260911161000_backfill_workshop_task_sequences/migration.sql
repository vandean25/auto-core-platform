-- Assign stable, 1-based task sequences to rows created before sequence
-- assignment was enforced by the workshop task service.
WITH ranked_zero_sequences AS (
  SELECT
    id,
    COALESCE(
      MAX(sequence) FILTER (WHERE sequence > 0) OVER (
        PARTITION BY workshop_order_id
      ),
      0
    ) + ROW_NUMBER() OVER (
      PARTITION BY workshop_order_id
      ORDER BY "createdAt", id
    )::integer AS assigned_sequence
  FROM workshop_tasks
  WHERE sequence = 0
)
UPDATE workshop_tasks AS task
SET sequence = ranked.assigned_sequence
FROM ranked_zero_sequences AS ranked
WHERE task.id = ranked.id;
