'use strict';

// ODI의 PARAMFIELD/DATAFIELD TYPE 속성은 java.sql.Types 코드다 (샘플 관찰: 12, 1, 2, -5, -1).

const JDBC_TYPE_NAMES = {
  [-7]: 'BIT',
  [-6]: 'TINYINT',
  [-5]: 'BIGINT',
  [-4]: 'LONGVARBINARY',
  [-3]: 'VARBINARY',
  [-2]: 'BINARY',
  [-1]: 'LONGVARCHAR',
  0: 'NULL',
  1: 'CHAR',
  2: 'NUMERIC',
  3: 'DECIMAL',
  4: 'INTEGER',
  5: 'SMALLINT',
  6: 'FLOAT',
  7: 'REAL',
  8: 'DOUBLE',
  12: 'VARCHAR',
  91: 'DATE',
  92: 'TIME',
  93: 'TIMESTAMP',
  2005: 'CLOB',
  2004: 'BLOB',
};

function jdbcTypeName(code) {
  return JDBC_TYPE_NAMES[code] || `TYPE(${code})`;
}

module.exports = { jdbcTypeName, JDBC_TYPE_NAMES };
