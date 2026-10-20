# Prints "schema.table|rows" for every COPY block in a pg_dump data file.
/^COPY / { table = $2; rows = 0; inside = 1; next }
inside && /^\\\.$/ { print table "|" rows; inside = 0; next }
inside { rows++ }
