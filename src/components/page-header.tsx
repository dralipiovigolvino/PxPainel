type PageHeaderProps = {
  title: string;
  /** Ação principal da página (ex.: "Nova conta"), à direita do título. */
  actions?: React.ReactNode;
};

export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3 md:mb-6">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
