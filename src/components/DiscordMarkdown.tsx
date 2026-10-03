import React, { useState } from 'react';

const MENTION_PILL =
  'inline-flex items-center bg-dc-accent/20 hover:bg-dc-accent text-[#c9cdfb] hover:text-white ' +
  'px-1.5 py-0.5 rounded font-medium cursor-pointer transition-colors text-[13px] align-baseline mx-0.5';

export interface DiscordMarkdownProps {
  content: string;
  userMap: Record<string, string>;
  searchQuery?: string;
  onMentionClick?: (userId: string, username?: string) => void;
  onMentionContextMenu?: (e: React.MouseEvent, userId: string, username?: string) => void;
  onChannelClick?: (channelId: string) => void;
  onChannelContextMenu?: (e: React.MouseEvent, channelId: string, channelName?: string) => void;
  onLinkContextMenu?: (e: React.MouseEvent, url: string) => void;
  onExternalUrlClick?: (e: React.MouseEvent, url: string) => void;
}

export function cleanUrl(url: string): { url: string; trailing: string } {
  let trailing = '';
  let cleaned = url;
  while (cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1];
    if ('.,:;!?\"\''.includes(last)) {
      trailing = last + trailing;
      cleaned = cleaned.slice(0, -1);
    } else if (last === ')' && (cleaned.match(/\)/g) || []).length > (cleaned.match(/\(/g) || []).length) {
      trailing = last + trailing;
      cleaned = cleaned.slice(0, -1);
    } else if (last === ']' && (cleaned.match(/\]/g) || []).length > (cleaned.match(/\[/g) || []).length) {
      trailing = last + trailing;
      cleaned = cleaned.slice(0, -1);
    } else {
      break;
    }
  }
  return { url: cleaned, trailing };
}

function highlightText(text: string, searchQuery?: string): React.ReactNode {
  if (!searchQuery || !searchQuery.trim()) {
    return text;
  }
  const escaped = searchQuery.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === searchQuery.toLowerCase() ? (
      <mark key={i} className="bg-yellow-500/40 text-yellow-100 rounded px-0.5 py-0 font-medium">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span
      onClick={() => setRevealed(true)}
      className={`rounded px-1 transition-all inline cursor-pointer select-none ${
        revealed
          ? 'bg-dc-dark/50 text-inherit cursor-default select-text'
          : 'bg-dc-dark hover:bg-dc-hover text-transparent [&_*]:invisible'
      }`}
      title={revealed ? undefined : 'Spoiler (click to reveal)'}
    >
      {children}
    </span>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-1.5 rounded-md bg-dc-darker border border-dc-divider p-3 text-xs font-mono text-dc-text overflow-x-auto group">
      {lang && (
        <span className="absolute top-1.5 right-14 text-[10px] uppercase font-semibold text-dc-text-muted select-none">
          {lang}
        </span>
      )}
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-1.5 right-2 text-[11px] px-2 py-0.5 rounded bg-dc-dark hover:bg-dc-hover text-dc-text-muted hover:text-white transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
        title="Copy code"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre className="m-0 whitespace-pre-wrap break-all font-mono leading-relaxed">{code}</pre>
    </div>
  );
}

interface InlineRule {
  type: string;
  regex: RegExp;
}

const INLINE_RULES: InlineRule[] = [
  { type: 'escape', regex: /\\([\\*_`~|()\[\]#+.!<>\\-])/ },
  { type: 'inlineCode', regex: /`([^`\n]+)`/ },
  { type: 'spoiler', regex: /\|\|([\s\S]+?)\|\|/ },
  { type: 'maskedLink', regex: /\[([^\]\n]+)\]\((https?:\/\/[^\s)\n]+)\)/ },
  {
    type: 'discordChannelUrl',
    regex: /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(?:@me|\d+)\/(\d+)/,
  },
  { type: 'suppressedUrl', regex: /<(https?:\/\/[^\s>\n]+)>/ },
  { type: 'userMention', regex: /<@!?(\d+)>/ },
  { type: 'channelMention', regex: /<#(\d+)>/ },
  { type: 'roleMention', regex: /<@&(\d+)>/ },
  { type: 'timestamp', regex: /<t:(\d+)(?::([a-zA-Z]))?>/ },
  { type: 'boldItalic', regex: /\*\*\*([\s\S]+?)\*\*\*/ },
  { type: 'bold', regex: /\*\*([\s\S]+?)\*\*/ },
  { type: 'underline', regex: /__([\s\S]+?)__/ },
  { type: 'strikethrough', regex: /~~([\s\S]+?)~~/ },
  { type: 'italicAsterisk', regex: /(?:^|[^\*])\*([^\*\n]+)\*(?:[^\*]|$)/ },
  { type: 'italicUnderscore', regex: /(?:^|[^\w])_([^\_\n]+)_(?:[^\w]|$)/ },
  { type: 'plainUrl', regex: /https?:\/\/[^\s<]+/ },
];

function renderInlineNodes(
  text: string,
  props: DiscordMarkdownProps,
  keyPrefix = 'inline'
): React.ReactNode[] {
  if (!text) return [];

  let earliest: { rule: InlineRule; match: RegExpExecArray; index: number } | null = null;

  for (const rule of INLINE_RULES) {
    const match = rule.regex.exec(text);
    if (match) {
      let matchIdx = match.index;
      if (
        (rule.type === 'italicAsterisk' || rule.type === 'italicUnderscore') &&
        match[0].length > 0 &&
        !match[0].startsWith('*') &&
        !match[0].startsWith('_')
      ) {
        matchIdx += 1;
      }

      if (earliest === null || matchIdx < earliest.index) {
        earliest = { rule, match, index: matchIdx };
        if (earliest.index === 0) break;
      }
    }
  }

  if (!earliest) {
    return [
      <React.Fragment key={`${keyPrefix}-txt`}>
        {highlightText(text, props.searchQuery)}
      </React.Fragment>,
    ];
  }

  const nodes: React.ReactNode[] = [];
  if (earliest.index > 0) {
    nodes.push(
      <React.Fragment key={`${keyPrefix}-pre`}>
        {highlightText(text.slice(0, earliest.index), props.searchQuery)}
      </React.Fragment>
    );
  }

  const fullMatch = earliest.match[0];
  let matchedLength = fullMatch.length;
  if (
    (earliest.rule.type === 'italicAsterisk' || earliest.rule.type === 'italicUnderscore') &&
    fullMatch.length > 0 &&
    !fullMatch.startsWith('*') &&
    !fullMatch.startsWith('_')
  ) {
    matchedLength -= 1;
  }
  if (
    (earliest.rule.type === 'italicAsterisk' || earliest.rule.type === 'italicUnderscore') &&
    fullMatch.length > 0 &&
    !fullMatch.endsWith('*') &&
    !fullMatch.endsWith('_')
  ) {
    matchedLength -= 1;
  }

  const innerText = earliest.match[1];
  const nodeKey = `${keyPrefix}-${earliest.index}`;

  switch (earliest.rule.type) {
    case 'escape':
      nodes.push(
        <React.Fragment key={nodeKey}>
          {highlightText(innerText, props.searchQuery)}
        </React.Fragment>
      );
      break;

    case 'inlineCode':
      nodes.push(
        <code
          key={nodeKey}
          className="bg-[#2b2d31] px-1.5 py-0.5 rounded font-mono text-[85%] text-[#e0e1e5] align-baseline inline-block"
        >
          {highlightText(innerText, props.searchQuery)}
        </code>
      );
      break;

    case 'spoiler':
      nodes.push(
        <Spoiler key={nodeKey}>
          {renderInlineNodes(innerText, props, `${nodeKey}-sp`)}
        </Spoiler>
      );
      break;

    case 'maskedLink': {
      const linkText = earliest.match[1];
      const linkUrl = earliest.match[2];
      nodes.push(
        <a
          key={nodeKey}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-dc-text-link hover:underline cursor-pointer break-all"
          onClick={(e) => props.onExternalUrlClick?.(e, linkUrl)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onLinkContextMenu?.(e, linkUrl);
          }}
        >
          {renderInlineNodes(linkText, props, `${nodeKey}-ml`)}
        </a>
      );
      break;
    }

    case 'discordChannelUrl': {
      const channelId = innerText;
      const chName = props.userMap[channelId];
      nodes.push(
        <span
          key={nodeKey}
          className={MENTION_PILL}
          title={`Channel ID: ${channelId}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onChannelClick?.(channelId);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onChannelContextMenu?.(e, channelId, chName);
          }}
        >
          #{chName || channelId}
        </span>
      );
      break;
    }

    case 'suppressedUrl': {
      const url = innerText;
      nodes.push(
        <a
          key={nodeKey}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-dc-text-link hover:underline cursor-pointer break-all"
          onClick={(e) => props.onExternalUrlClick?.(e, url)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onLinkContextMenu?.(e, url);
          }}
        >
          {highlightText(url, props.searchQuery)}
        </a>
      );
      break;
    }

    case 'plainUrl': {
      const { url, trailing } = cleanUrl(fullMatch);
      nodes.push(
        <React.Fragment key={nodeKey}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-dc-text-link hover:underline cursor-pointer break-all"
            onClick={(e) => props.onExternalUrlClick?.(e, url)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onLinkContextMenu?.(e, url);
            }}
          >
            {highlightText(url, props.searchQuery)}
          </a>
          {trailing ? highlightText(trailing, props.searchQuery) : null}
        </React.Fragment>
      );
      break;
    }

    case 'userMention': {
      const id = innerText;
      const resolvedName = props.userMap[id];
      nodes.push(
        resolvedName ? (
          <span
            key={nodeKey}
            className={MENTION_PILL}
            title={`User ID: ${id}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onMentionClick?.(id, resolvedName);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onMentionContextMenu?.(e, id, resolvedName);
            }}
          >
            @{resolvedName}
          </span>
        ) : (
          <span
            key={nodeKey}
            className="cursor-pointer hover:underline text-dc-text-link"
            title={`User ID: ${id}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onMentionClick?.(id, resolvedName);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onMentionContextMenu?.(e, id, resolvedName);
            }}
          >
            &lt;@{id}&gt;
          </span>
        )
      );
      break;
    }

    case 'channelMention': {
      const id = innerText;
      const chName = props.userMap[id];
      nodes.push(
        chName ? (
          <span
            key={nodeKey}
            className={MENTION_PILL}
            title={`Channel ID: ${id}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onChannelClick?.(id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onChannelContextMenu?.(e, id, chName);
            }}
          >
            #{chName}
          </span>
        ) : (
          <span
            key={nodeKey}
            className="cursor-pointer hover:underline text-dc-text-link"
            title={`Channel ID: ${id}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onChannelClick?.(id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onChannelContextMenu?.(e, id, chName);
            }}
          >
            &lt;#{id}&gt;
          </span>
        )
      );
      break;
    }

    case 'roleMention': {
      const id = innerText;
      nodes.push(
        <span
          key={nodeKey}
          className="inline-flex items-center bg-dc-accent/15 text-[#c9cdfb] px-1.5 py-0.5 rounded font-medium text-[13px] mx-0.5 align-baseline"
          title={`Role ID: ${id}`}
        >
          @role
        </span>
      );
      break;
    }

    case 'timestamp': {
      const ts = parseInt(innerText, 10);
      const d = !isNaN(ts) ? new Date(ts * 1000) : null;
      nodes.push(
        <span
          key={nodeKey}
          className="bg-dc-input/60 px-1 py-0.5 rounded text-xs text-dc-text-muted hover:text-white transition-colors"
          title={d ? d.toLocaleString() : innerText}
        >
          {d ? d.toLocaleDateString() : innerText}
        </span>
      );
      break;
    }

    case 'boldItalic':
      nodes.push(
        <strong key={nodeKey} className="font-bold text-white">
          <em className="italic">{renderInlineNodes(innerText, props, `${nodeKey}-bi`)}</em>
        </strong>
      );
      break;

    case 'bold':
      nodes.push(
        <strong key={nodeKey} className="font-bold text-white">
          {renderInlineNodes(innerText, props, `${nodeKey}-b`)}
        </strong>
      );
      break;

    case 'underline':
      nodes.push(
        <u key={nodeKey} className="underline">
          {renderInlineNodes(innerText, props, `${nodeKey}-u`)}
        </u>
      );
      break;

    case 'strikethrough':
      nodes.push(
        <s key={nodeKey} className="line-through opacity-80">
          {renderInlineNodes(innerText, props, `${nodeKey}-s`)}
        </s>
      );
      break;

    case 'italicAsterisk':
    case 'italicUnderscore':
      nodes.push(
        <em key={nodeKey} className="italic">
          {renderInlineNodes(innerText, props, `${nodeKey}-i`)}
        </em>
      );
      break;
  }

  const remainder = text.slice(earliest.index + matchedLength);
  if (remainder) {
    nodes.push(...renderInlineNodes(remainder, props, `${keyPrefix}-rem`));
  }

  return nodes;
}

export function DiscordMarkdown(props: DiscordMarkdownProps) {
  const { content } = props;
  if (!content) return null;

  const elements: React.ReactNode[] = [];
  const lines = content.split('\n');

  let i = 0;
  let blockIndex = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = [];
      const langMatch = line.trimStart().match(/^```([a-zA-Z0-9_-]*)/);
      const lang = langMatch ? langMatch[1] : undefined;

      const singleLineMatch = line.match(/^```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```$/);
      if (singleLineMatch && line.trim().endsWith('```') && line.trim().length > 5) {
        elements.push(
          <CodeBlock
            key={`block-${blockIndex++}`}
            code={singleLineMatch[2]}
            lang={singleLineMatch[1] || undefined}
          />
        );
        i++;
        continue;
      }

      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;

      elements.push(
        <CodeBlock key={`block-${blockIndex++}`} code={codeLines.join('\n')} lang={lang} />
      );
      continue;
    }

    if (line.startsWith('>>> ') || line === '>>>') {
      const quoteLines: string[] = [line.slice(3).replace(/^\s/, '')];
      i++;
      while (i < lines.length) {
        quoteLines.push(lines[i]);
        i++;
      }
      elements.push(
        <blockquote
          key={`block-${blockIndex++}`}
          className="border-l-4 border-[#4e5058] pl-3 my-1 text-dc-text-muted"
        >
          {quoteLines.map((ql, qIdx) => (
            <div key={qIdx} className="leading-tight">
              {renderInlineNodes(ql, props, `mlq-${blockIndex}-${qIdx}`)}
            </div>
          ))}
        </blockquote>
      );
      continue;
    }

    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i].slice(lines[i].startsWith('> ') ? 2 : 1));
        i++;
      }
      elements.push(
        <blockquote
          key={`block-${blockIndex++}`}
          className="border-l-4 border-[#4e5058] pl-3 my-1 text-dc-text-muted"
        >
          {quoteLines.map((ql, qIdx) => (
            <div key={qIdx} className="leading-tight">
              {renderInlineNodes(ql, props, `slq-${blockIndex}-${qIdx}`)}
            </div>
          ))}
        </blockquote>
      );
      continue;
    }

    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      elements.push(
        <h1 key={`block-${blockIndex++}`} className="text-xl font-bold text-white mt-2 mb-1">
          {renderInlineNodes(h1Match[1], props, `h1-${blockIndex}`)}
        </h1>
      );
      i++;
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      elements.push(
        <h2 key={`block-${blockIndex++}`} className="text-lg font-bold text-white mt-1.5 mb-0.5">
          {renderInlineNodes(h2Match[1], props, `h2-${blockIndex}`)}
        </h2>
      );
      i++;
      continue;
    }

    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      elements.push(
        <h3 key={`block-${blockIndex++}`} className="text-base font-bold text-white mt-1 mb-0.5">
          {renderInlineNodes(h3Match[1], props, `h3-${blockIndex}`)}
        </h3>
      );
      i++;
      continue;
    }

    const subtextMatch = line.match(/^-#\s+(.+)$/);
    if (subtextMatch) {
      elements.push(
        <div key={`block-${blockIndex++}`} className="text-xs text-dc-text-muted mt-0.5">
          {renderInlineNodes(subtextMatch[1], props, `sub-${blockIndex}`)}
        </div>
      );
      i++;
      continue;
    }

    const ulMatch = line.match(/^(\s*)(?:[-*])\s+(.+)$/);
    if (ulMatch) {
      const listItems: { indent: number; text: string }[] = [];
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)(?:[-*])\s+(.+)$/);
        if (!itemMatch) break;
        listItems.push({ indent: itemMatch[1].length, text: itemMatch[2] });
        i++;
      }
      elements.push(
        <ul key={`block-${blockIndex++}`} className="my-1 space-y-0.5 pl-2 list-none">
          {listItems.map((item, itemIdx) => (
            <li
              key={itemIdx}
              style={{ paddingLeft: `${item.indent * 8}px` }}
              className="flex items-baseline gap-2"
            >
              <span className="text-dc-text-muted select-none text-[10px]">•</span>
              <div className="flex-1">
                {renderInlineNodes(item.text, props, `ul-${blockIndex}-${itemIdx}`)}
              </div>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (olMatch) {
      const listItems: { num: string; indent: number; text: string }[] = [];
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)(\d+)\.\s+(.+)$/);
        if (!itemMatch) break;
        listItems.push({ num: itemMatch[2], indent: itemMatch[1].length, text: itemMatch[3] });
        i++;
      }
      elements.push(
        <ol key={`block-${blockIndex++}`} className="my-1 space-y-0.5 pl-2 list-none">
          {listItems.map((item, itemIdx) => (
            <li
              key={itemIdx}
              style={{ paddingLeft: `${item.indent * 8}px` }}
              className="flex items-baseline gap-2"
            >
              <span className="text-dc-text-muted select-none text-xs min-w-[16px]">{item.num}.</span>
              <div className="flex-1">
                {renderInlineNodes(item.text, props, `ol-${blockIndex}-${itemIdx}`)}
              </div>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    elements.push(
      <div key={`block-${blockIndex++}`} className="min-h-[1.25em]">
        {line.length === 0 ? (
          <span className="inline-block">&nbsp;</span>
        ) : (
          renderInlineNodes(line, props, `p-${blockIndex}`)
        )}
      </div>
    );
    i++;
  }

  return <div className="leading-tight">{elements}</div>;
}
