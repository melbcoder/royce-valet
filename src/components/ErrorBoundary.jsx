import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="card pad" style={{ margin: '40px auto', maxWidth: '600px' }}>
          <h2>Something went wrong</h2>
          <details style={{ whiteSpace: 'pre-wrap', marginTop: 20 }}>
            <summary>Error Details</summary>
            <p style={{ color: '#d32f2f', marginTop: 10 }}>
              {this.state.error && this.state.error.toString()}
            </p>
            <p style={{ color: '#666', fontSize: 12 }}>
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </p>
          </details>
          <button 
            className="btn secondary" 
            onClick={() => window.location.href = '/login'}
            style={{ marginTop: 20 }}
          >
            Return to Login
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;