/**
 * 从 LLM 响应中提取 JSON
 * 处理 markdown 代码块、前后文本、控制字符等常见格式
 */

/**
 * 清理 JSON 字符串中的控制字符（literal newlines/tabs in string values）
 */
function cleanControlChars(json: string): string {
  // 替换字符串值中的字面换行/制表符
  return json
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export function extractJSON(text: string): string {
  // 1. 尝试提取 markdown 代码块
  const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) {
    const inner = mdMatch[1].trim();
    if (isValidJSON(inner)) return inner;
  }

  // 2. 尝试找第一个完整的 JSON 对象
  const objMatch = extractBalancedBraces(text);
  if (objMatch) {
    const cleaned = cleanControlChars(objMatch);
    if (isValidJSON(cleaned)) return cleaned;
    if (isValidJSON(objMatch)) return objMatch;
  }

  // 3. 回退
  return text;
}

function extractBalancedBraces(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function isValidJSON(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function safeParseJSON<T = unknown>(text: string, context?: string): T {
  const extracted = extractJSON(text);
  try {
    return JSON.parse(extracted) as T;
  } catch (e) {
    const preview = text.slice(0, 200);
    throw new Error(
      `Failed to parse JSON${context ? ' (' + context + ')' : ''}: ${(e as Error).message}\nPreview: ${preview}...`,
    );
  }
}
