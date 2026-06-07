import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/// Рендерит Markdown красиво (заголовки, списки, выделение) вместо сырых *.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
