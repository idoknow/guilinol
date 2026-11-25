CREATE TABLE IF NOT EXISTS npc_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    settings jsonb NOT NULL
);
