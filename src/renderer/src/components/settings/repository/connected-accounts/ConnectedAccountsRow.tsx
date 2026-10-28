export function ConnectedAccountsRow({
  title,
  labelId,
  description,
  children
}: {
  title: string
  labelId?: string
  description?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <div id={labelId} className="text-sm font-medium">
        {title}
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  )
}
