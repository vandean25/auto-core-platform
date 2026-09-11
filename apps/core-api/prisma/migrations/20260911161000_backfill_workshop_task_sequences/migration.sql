-- Assign stable, 1-based task sequences to rows created before sequence
-- assignment was enforced by the workshop task service.
WITH order_max AS (
  SELECT
    workshop_order_id,
    COALESCE(MAX(sequence) FILTER (WHERE sequence > 0), 0) AS max_sequence
  FROM workshop_tasks
  GROUP BY workshop_order_id
),
ranked_zero_sequences AS (
  SELECT
    task.id,
    order_max.max_sequence + ROW_NUMBER() OVER (
      PARTITION BY task.workshop_order_id
      ORDER BY task."createdAt", task.id
    )::integer AS assigned_sequence
  FROM workshop_tasks AS task
  JOIN order_max ON order_max.workshop_order_id = task.workshop_order_id
  WHERE task.sequence = 0
)
UPDATE workshop_tasks AS task
SET sequence = ranked.assigned_sequence
FROM ranked_zero_sequences AS ranked
WHERE task.id = ranked.id;
