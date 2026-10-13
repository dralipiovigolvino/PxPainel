import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SectionCardProps = {
  id: string;
  title: string;
  className?: string;
  children: React.ReactNode;
};

/** Seção de página com título; `id` liga o título à região para leitores de tela. */
export function SectionCard({ id, title, className, children }: SectionCardProps) {
  const headingId = `${id}-titulo`;
  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className={cn("shadow-xs ring-border", className)}
    >
      <CardHeader>
        <CardTitle>
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  );
}
