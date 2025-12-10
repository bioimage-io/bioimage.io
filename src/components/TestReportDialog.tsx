import React from 'react';
import { DetailedTestReport } from '../types/artifact';
import TestDetailsDialog from './TestDetailsDialog';

interface TestReportDialogProps {
  open: boolean;
  onClose: () => void;
  testReport: DetailedTestReport | null;
  isLoading: boolean;
  rawErrorContent?: string | null;
  isInvalidJson?: boolean;
}

const TestReportDialog: React.FC<TestReportDialogProps> = ({
  open,
  onClose,
  testReport,
  isLoading,
  rawErrorContent,
  isInvalidJson = false,
}) => {
  return (
    <TestDetailsDialog
      open={open}
      onClose={onClose}
      data={testReport}
      isLoading={isLoading}
      rawErrorContent={rawErrorContent}
      isInvalidJson={isInvalidJson}
      type="test-report"
    />
  );
};

export default TestReportDialog; 