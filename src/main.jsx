import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Shows the error text instead of a blank page if something crashes while rendering.
class Boundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    return this.state.err
      ? <pre style={{ padding: 16, whiteSpace: 'pre-wrap' }}>Something broke: {String(this.state.err.message || this.state.err)}</pre>
      : this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);