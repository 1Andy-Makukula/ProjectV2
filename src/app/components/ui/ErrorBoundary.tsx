import { Component, ErrorInfo, ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from './button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] w-full flex-col items-center justify-center p-6 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
            <ShieldAlert className="h-8 w-8 text-red-500" strokeWidth={1.5} />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-slate-900">
            Oops, something went wrong with the terminal.
          </h2>
          <p className="mb-6 max-w-sm text-sm text-slate-500">
            A critical error occurred while rendering this component. Please reset the terminal to continue.
          </p>
          <Button 
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reset Terminal
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
