import { Button, EmptyState, Icon } from "../ui";

export function LibraryLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        tone="danger"
        icon="alert"
        title="Your library couldn’t be loaded"
        description="The server didn’t answer. Check that it’s running, then try again."
        className="animate-rise"
        actions={
          <Button onClick={onRetry}>
            <Icon name="refresh" size={16} />
            Try again
          </Button>
        }
      />
    </div>
  );
}
