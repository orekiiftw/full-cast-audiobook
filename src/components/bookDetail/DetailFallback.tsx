import { Button, EmptyState, Icon } from "../ui";
import { DETAIL_PAGE_CLASS } from "./layout";

interface DetailFallbackProps {
  title: string;
  message: string;
  onBack: () => void;
  onRetry?: () => void;
}

export function DetailFallback({ title, message, onBack, onRetry }: DetailFallbackProps) {
  return (
    <div className={DETAIL_PAGE_CLASS}>
      <EmptyState
        headingLevel="h1"
        tone={onRetry ? "danger" : "neutral"}
        icon={onRetry ? "alert" : "book"}
        title={title}
        description={message}
        className="mt-4 animate-rise"
        actions={
          <>
            <Button onClick={onBack}>
              <Icon name="chevronLeft" size={16} />
              Back to Library
            </Button>
            {onRetry && (
              <Button variant="primary" onClick={onRetry}>
                <Icon name="refresh" size={16} />
                Try again
              </Button>
            )}
          </>
        }
      />
    </div>
  );
}
