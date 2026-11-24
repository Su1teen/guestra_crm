ALTER TABLE agent_action_executions
  DROP CONSTRAINT IF EXISTS agent_action_executions_action_type_check,
  ADD CONSTRAINT agent_action_executions_action_type_check
    CHECK (action_type IN (
      'book_accommodation', 'book_service', 'reschedule_service', 'cancel_service',
      'extend_stay', 'amend_accommodation', 'cancel_accommodation', 'create_remote_prepayment'
    ));
