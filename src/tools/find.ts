import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { generateTempFilePath } from '../utils/streaming.js';

const findSchema = z.object({
  database: z.string().describe('Database name'),
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),
  table: z.string().describe('Table name to query'),
  filter: z.record(z.unknown()).optional().default({}).describe('Filter conditions for the query'),
  limit: z.number().optional().default(10).describe('The maximum number of records to return'),
  columns: z.array(z.string()).optional().describe('Specific columns to return (default: all columns)'),
  where: z.string().optional().describe('SQL WHERE clause conditions'),
  order_by: z.string().optional().describe('SQL ORDER BY clause'),
  saveToFile: z.boolean().optional().describe('Save results to a file instead of returning them directly. Useful for large datasets that can be analyzed by scripts.'),
  filePath: z.string().optional().describe('Explicit path to save the file (optional, auto-generated if not provided). Directory will be created if it doesn\'t exist.'),
});

export type FindParams = z.infer<typeof findSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerFindTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'find',
    {
      title: 'Find Records',
      description: 'Query data from PostgreSQL table with filtering options',
      inputSchema: findSchema.shape,
    },
    async (params: FindParams) => {
      const { database, schema = 'public', table, filter = {}, limit = 10, columns, where, order_by, saveToFile } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        // Build the SELECT query
        let selectColumns = '*';
        if (columns && columns.length > 0) {
          selectColumns = columns.map(col => `"${col}"`).join(', ');
        }

        let query = `SELECT ${selectColumns} FROM "${schema}"."${table}"`;
        const queryParams: any[] = [];
        let paramIndex = 1;

        // Apply filter conditions if provided
        if (Object.keys(filter).length > 0) {
          const conditions = [];
          for (const [key, value] of Object.entries(filter)) {
            conditions.push(`"${key}" = $${paramIndex}`);
            queryParams.push(value);
            paramIndex++;
          }
          query += ` WHERE ${conditions.join(' AND ')}`;
        }

        // Apply additional WHERE clause if provided
        if (where) {
          const whereClause = where.trim();
          if (whereClause.toUpperCase().startsWith('ORDER BY') || 
              whereClause.toUpperCase().startsWith('LIMIT')) {
            // If the WHERE clause starts with ORDER BY or LIMIT, append it directly
            query += ` ${whereClause}`;
          } else {
            // Otherwise, prepend WHERE if it's not already there
            query += ` ${query.includes('WHERE') ? 'AND' : 'WHERE'} ${whereClause}`;
          }
        }

        // Apply ORDER BY if provided
        if (order_by) {
          query += ` ORDER BY ${order_by}`;
        }

        // Apply LIMIT with the minimum of user-provided limit and 1000 to prevent memory issues
        const effectiveLimit = Math.min(limit, 1000);
        query += ` LIMIT $${paramIndex}`;
        queryParams.push(effectiveLimit);

        if (saveToFile) {
          // For saving to file, execute the query and save results
          const { filePath = generateTempFilePath() } = params;
          // Ensure directory exists
          const dir = dirname(filePath);
          await mkdir(dir, { recursive: true });

          // Execute query and store results
          const results = await client.executeQuery<any>(query, queryParams);

          // Write results to file
          // This is a simplified approach - in a real implementation, we'd want to
          // stream large results directly to file rather than loading everything in memory
          await import('fs/promises').then(fs => 
            fs.writeFile(filePath, JSON.stringify(results, null, 2))
          );

          return toolSuccess({
            savedToFile: true,
            filePath,
            database,
            schema,
            table,
            count: results.length,
            message: `${results.length} records were written to the file.`,
          });
        } else {
          // Execute the query
          const results = await client.executeQuery<any>(query, queryParams);
          
          return toolSuccess({
            database,
            schema,
            table,
            records: results,
            count: results.length,
            limit: effectiveLimit,
          });
        }
      } catch (error) {
        return toolError(error);
      }
    },
  );
}