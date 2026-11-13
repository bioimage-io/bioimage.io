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
  /** Published core version, set only when this staged report is behind it. See svamp #0017. */
  staleAgainstCoreVersion?: string | null;
}

const TestReportDialog: React.FC<TestReportDialogProps> = ({
  open,
  onClose,
  testReport,
  isLoading,
  rawErrorContent,
  isInvalidJson = false,
  staleAgainstCoreVersion = null,
}) => {
  return (
    <TestDetailsDialog
      open={open}
      onClose={onClose}
      data={testReport}
      isLoading={isLoading}
      rawErrorContent={rawErrorContent}
      isInvalidJson={isInvalidJson}
      staleAgainstCoreVersion={staleAgainstCoreVersion}
      type="test-report"
    />
  );
};

export default TestReportDialog; 