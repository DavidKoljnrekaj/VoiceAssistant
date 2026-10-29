import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Assistant text as Markdown. Links open in a new tab; images are not fetched (the text comes from
 * the model and from tool output, and an image address would be fetched by every reader).
 */
export default function MarkdownView({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mt-3 mb-1 text-lg font-bold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-3 mb-1 text-base font-bold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold">{children}</h3>,
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt}</span>,
          code: ({ children }) => (
            <code className="rounded-sm bg-gray-200 px-1 py-0.5 text-xs dark:bg-gray-800">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-sm bg-gray-200 p-3 text-xs dark:bg-gray-800">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 border-l-4 border-gray-300 pl-3 italic dark:border-gray-600">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border border-gray-300 text-xs dark:border-gray-600">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-300 bg-gray-200 px-2 py-1 text-left font-semibold dark:border-gray-600 dark:bg-gray-800">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-300 px-2 py-1 dark:border-gray-600">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
