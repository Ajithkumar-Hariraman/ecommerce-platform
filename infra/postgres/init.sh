#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres --set=app_password="$DB_PASSWORD" <<'SQL'
CREATE ROLE ecommerce_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE DATABASE ecommerce_dev OWNER ecommerce_app;
CREATE DATABASE ecommerce_test OWNER ecommerce_app;
SQL
