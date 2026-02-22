/**
 * Google Workspace MCP Server for NanoClaw
 * Embedded Gmail, Calendar, Drive, and Sheets tools using the official googleapis package.
 *
 * Modes:
 *   node google-mcp-stdio.js auth   — run OAuth flow, save tokens, exit
 *   node google-mcp-stdio.js        — start MCP stdio server
 *
 * Reads credentials from GOOGLE_CREDS_DIR env var:
 *   oauth-keys.json  — Google Cloud OAuth client credentials
 *   tokens.json      — refresh/access tokens from OAuth flow
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { auth as googleAuth, gmail } from '@googleapis/gmail';
import { calendar } from '@googleapis/calendar';
import { drive } from '@googleapis/drive';
import { sheets } from '@googleapis/sheets';

const CREDS_DIR = process.env.GOOGLE_CREDS_DIR || '/home/node/.config/nanoclaw-google';
const KEYS_PATH = path.join(CREDS_DIR, 'oauth-keys.json');
const TOKENS_PATH = path.join(CREDS_DIR, 'tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
];

// ---------------------------------------------------------------------------
// Auth mode: run OAuth flow and save tokens
// ---------------------------------------------------------------------------

if (process.argv[2] === 'auth') {
  const keys = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf-8'));
  const { client_id, client_secret } = keys.installed || keys.web;
  const PORT = 3000;
  const redirectUri = `http://localhost:${PORT}/oauth2callback`;

  const auth = new googleAuth.OAuth2(client_id, client_secret, redirectUri);
  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log(`\nOpen this URL in your browser:\n\n${authUrl}\n`);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400);
      res.end('Missing authorization code');
      return;
    }

    try {
      const { tokens } = await auth.getToken(code);
      fs.mkdirSync(CREDS_DIR, { recursive: true });
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authentication successful!</h1><p>You can close this tab.</p>');
      console.log(`Tokens saved to ${TOKENS_PATH}`);
      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500);
      res.end(`Error exchanging code: ${err}`);
      console.error('Auth error:', err);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log('Waiting for authorization...');
  });
} else {
  // -------------------------------------------------------------------------
  // MCP server mode
  // -------------------------------------------------------------------------

  if (!fs.existsSync(KEYS_PATH)) {
    console.error(`Missing ${KEYS_PATH} — run with "auth" argument first`);
    process.exit(1);
  }
  if (!fs.existsSync(TOKENS_PATH)) {
    console.error(`Missing ${TOKENS_PATH} — run with "auth" argument first`);
    process.exit(1);
  }

  const keys = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf-8'));
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  const { client_id, client_secret } = keys.installed || keys.web;

  const auth = new googleAuth.OAuth2(client_id, client_secret);
  auth.setCredentials(tokens);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- packages ship conflicting google-auth-library versions
  const authAny = auth as any;
  const gmailClient = gmail({ version: 'v1', auth: authAny });
  const calendarClient = calendar({ version: 'v3', auth: authAny });
  const driveClient = drive({ version: 'v3', auth: authAny });
  const sheetsClient = sheets({ version: 'v4', auth: authAny });

  // Helper: extract plain text body from a Gmail message payload
  function extractBody(payload: { body?: { data?: string }; parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }> }): string {
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    }
    if (payload.parts) {
      const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        return Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
      }
      const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
      if (htmlPart?.body?.data) {
        return Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8');
      }
    }
    return '';
  }

  // Helper: get header value from Gmail message
  function getHeader(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
    return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
  }

  // Helper: format error for MCP response
  function errorResult(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
  }

  function ok(text: string) {
    return { content: [{ type: 'text' as const, text }] };
  }

  const server = new McpServer({ name: 'google', version: '1.0.0' });

  // --- Gmail tools ---

  server.tool(
    'gmail_search',
    'Search Gmail messages. Uses Gmail search syntax (e.g., "from:alice@example.com is:unread", "subject:invoice after:2026/01/01").',
    {
      query: z.string().describe('Gmail search query'),
      max_results: z.number().int().min(1).max(50).default(10).describe('Max results to return'),
    },
    async (args) => {
      try {
        const list = await gmailClient.users.messages.list({
          userId: 'me',
          q: args.query,
          maxResults: args.max_results,
        });

        if (!list.data.messages?.length) return ok('No messages found.');

        const results = await Promise.all(
          list.data.messages.map(async (m) => {
            const msg = await gmailClient.users.messages.get({
              userId: 'me',
              id: m.id!,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'Date'],
            });
            const headers = msg.data.payload?.headers || [];
            return {
              id: m.id,
              subject: getHeader(headers, 'Subject'),
              from: getHeader(headers, 'From'),
              date: getHeader(headers, 'Date'),
              snippet: msg.data.snippet,
            };
          }),
        );

        return ok(JSON.stringify(results, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'gmail_read',
    'Read the full content of a Gmail message by its ID (from gmail_search results).',
    {
      message_id: z.string().describe('Gmail message ID'),
    },
    async (args) => {
      try {
        const msg = await gmailClient.users.messages.get({
          userId: 'me',
          id: args.message_id,
          format: 'full',
        });

        const headers = msg.data.payload?.headers || [];
        const body = extractBody(msg.data.payload as Parameters<typeof extractBody>[0]);

        return ok(JSON.stringify({
          id: msg.data.id,
          threadId: msg.data.threadId,
          subject: getHeader(headers, 'Subject'),
          from: getHeader(headers, 'From'),
          to: getHeader(headers, 'To'),
          date: getHeader(headers, 'Date'),
          body: body.slice(0, 50000),
        }, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'gmail_send',
    'Send an email. Optionally reply to an existing thread.',
    {
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body (plain text)'),
      reply_to_id: z.string().optional().describe('Message ID to reply to (for threading)'),
    },
    async (args) => {
      try {
        let inReplyTo = '';
        let references = '';
        let threadId: string | undefined;

        if (args.reply_to_id) {
          const orig = await gmailClient.users.messages.get({
            userId: 'me',
            id: args.reply_to_id,
            format: 'metadata',
            metadataHeaders: ['Message-ID', 'References'],
          });
          const headers = orig.data.payload?.headers || [];
          inReplyTo = getHeader(headers, 'Message-ID');
          references = `${getHeader(headers, 'References')} ${inReplyTo}`.trim();
          threadId = orig.data.threadId || undefined;
        }

        const messageParts = [
          `To: ${args.to}`,
          `Subject: ${args.reply_to_id ? 'Re: ' : ''}${args.subject}`,
          'Content-Type: text/plain; charset=utf-8',
        ];
        if (inReplyTo) {
          messageParts.push(`In-Reply-To: ${inReplyTo}`);
          messageParts.push(`References: ${references}`);
        }
        messageParts.push('', args.body);

        const raw = Buffer.from(messageParts.join('\r\n')).toString('base64url');
        const sent = await gmailClient.users.messages.send({
          userId: 'me',
          requestBody: { raw, threadId },
        });

        return ok(JSON.stringify({ message_id: sent.data.id, thread_id: sent.data.threadId }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Calendar tools ---

  server.tool(
    'calendar_list',
    'List upcoming calendar events.',
    {
      days_ahead: z.number().int().min(1).max(90).default(7).describe('Number of days ahead to fetch'),
      query: z.string().optional().describe('Text search within events'),
      calendar_id: z.string().default('primary').describe('Calendar ID'),
    },
    async (args) => {
      try {
        const now = new Date();
        const end = new Date(now.getTime() + args.days_ahead * 24 * 3600000);
        const events = await calendarClient.events.list({
          calendarId: args.calendar_id,
          timeMin: now.toISOString(),
          timeMax: end.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 50,
          q: args.query || undefined,
        });

        if (!events.data.items?.length) return ok('No upcoming events.');

        const results = events.data.items.map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          location: e.location || undefined,
          description: e.description ? e.description.slice(0, 200) : undefined,
        }));

        return ok(JSON.stringify(results, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'calendar_create',
    'Create a calendar event.',
    {
      summary: z.string().describe('Event title'),
      start: z.string().describe('Start datetime ISO 8601 (e.g., "2026-02-22T10:00:00")'),
      end: z.string().describe('End datetime ISO 8601'),
      description: z.string().optional().describe('Event description'),
      location: z.string().optional().describe('Event location'),
      calendar_id: z.string().default('primary').describe('Calendar ID'),
    },
    async (args) => {
      try {
        const event = await calendarClient.events.insert({
          calendarId: args.calendar_id,
          requestBody: {
            summary: args.summary,
            start: { dateTime: args.start },
            end: { dateTime: args.end },
            description: args.description,
            location: args.location,
          },
        });

        return ok(JSON.stringify({
          id: event.data.id,
          summary: event.data.summary,
          htmlLink: event.data.htmlLink,
        }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'calendar_update',
    'Update an existing calendar event. Only provided fields are changed.',
    {
      event_id: z.string().describe('Event ID from calendar_list'),
      summary: z.string().optional().describe('New title'),
      start: z.string().optional().describe('New start datetime ISO 8601'),
      end: z.string().optional().describe('New end datetime ISO 8601'),
      description: z.string().optional().describe('New description'),
      location: z.string().optional().describe('New location'),
      calendar_id: z.string().default('primary').describe('Calendar ID'),
    },
    async (args) => {
      try {
        const patch: Record<string, unknown> = {};
        if (args.summary !== undefined) patch.summary = args.summary;
        if (args.start !== undefined) patch.start = { dateTime: args.start };
        if (args.end !== undefined) patch.end = { dateTime: args.end };
        if (args.description !== undefined) patch.description = args.description;
        if (args.location !== undefined) patch.location = args.location;

        const event = await calendarClient.events.patch({
          calendarId: args.calendar_id,
          eventId: args.event_id,
          requestBody: patch,
        });

        return ok(JSON.stringify({ id: event.data.id, summary: event.data.summary }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'calendar_delete',
    'Delete a calendar event.',
    {
      event_id: z.string().describe('Event ID from calendar_list'),
      calendar_id: z.string().default('primary').describe('Calendar ID'),
    },
    async (args) => {
      try {
        await calendarClient.events.delete({
          calendarId: args.calendar_id,
          eventId: args.event_id,
        });
        return ok(`Event ${args.event_id} deleted.`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Drive tools ---

  server.tool(
    'drive_search',
    "Search Google Drive files. Uses Drive query syntax (e.g., \"name contains 'budget'\", \"mimeType='application/vnd.google-apps.document'\", \"fullText contains 'quarterly'\").",
    {
      query: z.string().describe('Drive search query'),
      max_results: z.number().int().min(1).max(50).default(10).describe('Max results'),
    },
    async (args) => {
      try {
        const files = await driveClient.files.list({
          q: args.query,
          pageSize: args.max_results,
          fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
          orderBy: 'modifiedTime desc',
        });

        if (!files.data.files?.length) return ok('No files found.');

        return ok(JSON.stringify(files.data.files, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'drive_read',
    'Read the content of a Google Drive file. Google Docs/Sheets/Slides are exported as plain text. Other text files are downloaded directly.',
    {
      file_id: z.string().describe('Drive file ID from drive_search'),
    },
    async (args) => {
      try {
        const meta = await driveClient.files.get({
          fileId: args.file_id,
          fields: 'name,mimeType',
        });
        const fileData = meta.data as { name?: string; mimeType?: string };
        const name = fileData.name || 'unknown';
        const mimeType = fileData.mimeType || '';

        const googleTypes: Record<string, string> = {
          'application/vnd.google-apps.document': 'text/plain',
          'application/vnd.google-apps.spreadsheet': 'text/csv',
          'application/vnd.google-apps.presentation': 'text/plain',
        };

        let content: string;
        if (googleTypes[mimeType]) {
          const res = await driveClient.files.export({
            fileId: args.file_id,
            mimeType: googleTypes[mimeType],
          });
          content = String(res.data);
        } else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
          const res = await driveClient.files.get(
            { fileId: args.file_id, alt: 'media' },
            { responseType: 'text' },
          );
          content = String(res.data);
        } else {
          return ok(JSON.stringify({ name, mimeType, content: `[Binary file — cannot display. Use webViewLink to open in browser.]` }));
        }

        if (content.length > 50000) {
          content = content.slice(0, 50000) + '\n\n[Content truncated at 50,000 characters]';
        }

        return ok(JSON.stringify({ name, mimeType, content }, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Sheets tools ---

  server.tool(
    'sheets_read',
    'Read cell values from a Google Sheets spreadsheet.',
    {
      spreadsheet_id: z.string().describe('Spreadsheet ID (from drive_search or the URL)'),
      range: z.string().describe('A1 notation range (e.g., "Sheet1!A1:D10", "A1:Z100")'),
    },
    async (args) => {
      try {
        const res = await sheetsClient.spreadsheets.values.get({
          spreadsheetId: args.spreadsheet_id,
          range: args.range,
        });

        return ok(JSON.stringify({
          range: res.data.range,
          values: res.data.values || [],
        }, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'sheets_write',
    'Write cell values to a Google Sheets spreadsheet.',
    {
      spreadsheet_id: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('A1 notation range to write to (e.g., "Sheet1!A1")'),
      values: z.array(z.array(z.string())).describe('2D array of values (rows of columns)'),
      value_input_option: z.enum(['RAW', 'USER_ENTERED']).default('USER_ENTERED').describe('RAW=literal strings, USER_ENTERED=parse formulas and dates'),
    },
    async (args) => {
      try {
        const res = await sheetsClient.spreadsheets.values.update({
          spreadsheetId: args.spreadsheet_id,
          range: args.range,
          valueInputOption: args.value_input_option,
          requestBody: { values: args.values },
        });

        return ok(JSON.stringify({
          updatedRange: res.data.updatedRange,
          updatedCells: res.data.updatedCells,
          updatedRows: res.data.updatedRows,
          updatedColumns: res.data.updatedColumns,
        }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
