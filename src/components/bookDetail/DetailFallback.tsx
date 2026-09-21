import { Button, Icon } from "../ui";

interface DetailFallbackProps {
  title: string;
  message: string;
  onBack: () => void;
  onRetry?: () => void;
}

export function DetailFallback({ title, message, onBack, onRetry }: DetailFallbackProps) {
  const backButton = (
    <Button variant="secondary" onClick={onBack}>
      <Icon name="chevronLeft" size={16} />
      Back to Library
    </Button>
  );

  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-6 py-20 text-center">
      <h1 className="font-serif text-3xl font-medium mb-3 text-gradient">{title}</h1>
      <p className="text-cinema-400 text-sm mb-8">{message}</p>
      {onRetry ? (
        <div className="flex justify-center gap-3">
          {backButton}
          <Button variant="primary" onClick={onRetry}>
            <Icon name="refresh" size={14} />
            Retry
          </Button>
        </div>
      ) : (
        backButton
      )}
    </div>
  );
}
