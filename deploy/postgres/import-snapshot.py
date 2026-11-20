"""Render an atomic psql input stream from a trusted glol D1 SQLite export."""
import pathlib
import sqlite3
import sys

TABLES = ('users', 'sessions', 'email_codes', 'mail_events', 'rate_limits',
          'feedback', 'feedback_photos', 'feedback_upload_usage', 'feedback_events',
          'feedback_messages', 'feedback_mail')


def field(value):
    if value is None:
        return r'\N'
    return str(value).replace('\\', r'\\').replace('\t', r'\t').replace('\n', r'\n').replace('\r', r'\r')


def main(path):
    source = sqlite3.connect(':memory:')
    source.executescript(path.read_text())
    tables = {name for name, in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    unexpected = tables - set(TABLES) - {'d1_migrations', 'sqlite_sequence', '_cf_KV'}
    if unexpected or set(TABLES) - tables:
        raise ValueError('Unexpected source schema; refusing partial import')
    if source.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('Source contains broken references')
    print(r'\set ON_ERROR_STOP on')
    print('BEGIN;')
    print("DO $$ BEGIN IF current_database() != 'glol' THEN RAISE EXCEPTION 'Expected glol target'; END IF; END $$;")
    print('TRUNCATE', ','.join(TABLES), ';')
    for table in TABLES:
        print(f'ALTER TABLE {table} DISABLE TRIGGER USER;')
    for table in TABLES:
        columns = 'rowid,*' if table in ('users', 'feedback') else '*'
        rows = source.execute(f'SELECT {columns} FROM {table}')
        names = ','.join('"' + col[0].replace('"', '""') + '"' for col in rows.description)
        print(f'COPY {table} ({names}) FROM STDIN;')
        total = 0
        for row in rows:
            print('\t'.join(map(field, row)))
            total += 1
        print(r'\.')
        print(f'DO $$ BEGIN IF (SELECT count(*) FROM {table}) != {total} THEN RAISE EXCEPTION \'row count mismatch: {table}\'; END IF; END $$;')
        print(f'SELECT \'{table}\' AS relation, {total} AS d1, count(*) AS pg FROM {table};')
    for table in TABLES:
        print(f'ALTER TABLE {table} ENABLE TRIGGER USER;')
    for table, key in [('feedback_messages', 'id'), ('feedback_events', 'id'), ('users', 'rowid'), ('feedback', 'rowid')]:
        print(f"SELECT setval(pg_get_serial_sequence('{table}','{key}'), coalesce(max({key}),1), max({key}) IS NOT NULL) FROM {table};")
    print('COMMIT;')


if __name__ == '__main__':
    main(pathlib.Path(sys.argv[1]))
