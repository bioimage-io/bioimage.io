import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';

describe('App', () => {
  test('renders without crashing', () => {
    render(<App />);
    // Update test to match your actual content
    const element = screen.getByRole('navigation');
    expect(element).toBeInTheDocument();
  });
});
