import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const insertSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),
  table: z.string().describe('Table name to insert into'),
  record: z.record(z.unknown()).describe('Record to insert'),
  records: z.array(z.record(z.unknown())).optional().describe('Array of records to insert (use instead of single record)'),
});

export type InsertParams = z.infer<typeof insertSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerInsertTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'insert',
    {
      title: 'Insert Records',
      description: 'Insert one or multiple records into a PostgreSQL table. Use for: Adding new records to PostgreSQL tables.',
      inputSchema: insertSchema.shape,
    },
    async (params: InsertParams) => {
      const { schema = 'public', table, record, records } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if in read-only mode
      if (client.isReadonly()) {
        return toolError(new Error('Cannot perform insert operation in read-only mode'));
      }

      try {
        if (records && records.length > 0) {
          // Insert multiple records
          if (records.length === 0) {
            return toolSuccess({
              schema,
              table,
              insertedCount: 0,
              operation: 'insertMany',
            });
          }

          // Use the first record to determine column names
          const firstRecord = records[0]!;
          const columns = Object.keys(firstRecord);
          const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
          
          // Prepare the query for multiple insertions
          let query = `INSERT INTO "${schema}"."${table}" ("${columns.join('", "')}") VALUES `;
          const allValues: unknown[] = [];
          
          for (let i = 0; i < records.length; i++) {
            if (i > 0) {
              query += ', ';
            }
            // Adjust placeholder indices for each row
            const rowPlaceholders = columns.map((_, colIndex) => `$${i * columns.length + colIndex + 1}`).join(', ');
            query += `(${rowPlaceholders})`;
            
            // Add values for this row
            const recordValues = columns.map(col => records[i]![col]);
            allValues.push(...recordValues);
          }
          
          query += ' RETURNING *';

          const result = await client.executeQuery<any>(query, allValues);

          return toolSuccess({
            schema,
            table,
            insertedCount: records.length,
            operation: 'insertMany',
            returnedRecords: result,
          });
        } else {
          // Insert single record
          const columns = Object.keys(record);
          const values = columns.map(col => record[col]);
          const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

          const query = `INSERT INTO "${schema}"."${table}" ("${columns.join('", "')}") VALUES (${placeholders}) RETURNING *`;

          const result = await client.executeQuery<any>(query, values);

          return toolSuccess({
            schema,
            table,
            insertedId: result[0]?.id || 'unknown', // PostgreSQL doesn't guarantee an 'id' column
            insertedCount: 1,
            operation: 'insertOne',
            returnedRecord: result[0],
          });
        }
      } catch (error) {
        return toolError(error);
      }
    },
  );
}