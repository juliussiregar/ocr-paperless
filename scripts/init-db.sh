#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE app'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'app')\gexec
    GRANT ALL PRIVILEGES ON DATABASE app TO $POSTGRES_USER;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname app <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;
EOSQL
