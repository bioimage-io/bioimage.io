import React, { useState } from 'react';
import {
  Box,
  Tooltip,
  Popover,
  Typography,
  Stack,
  Chip,
  CircularProgress,
  IconButton,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningIcon from '@mui/icons-material/Warning';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import InfoIcon from '@mui/icons-material/Info';
import { ArtifactInfo, TestReport, DetailedTestReport } from '../types/artifact';
import { resolveHyphaUrl } from '../utils/urlHelpers';
import TestReportDialog from './TestReportDialog';

interface TestReportBadgeProps {
  artifact: ArtifactInfo;
  mode?: 'floating' | 'inline'; // floating for card, inline for details page
  size?: 'small' | 'medium' | 'large';
  showPopover?: boolean; // if false, shows dialog instead
  onStopPropagation?: boolean; // whether to stop event propagation
}

const TestReportBadge: React.FC<TestReportBadgeProps> = ({
  artifact,
  mode = 'floating',
  size = 'medium',
  showPopover = true,
  onStopPropagation = true,
}) => {
  const [popoverAnchorEl, setPopoverAnchorEl] = useState<HTMLElement | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [detailedTestReport, setDetailedTestReport] = useState<DetailedTestReport | null>(null);
  const [isLoadingTestReport, setIsLoadingTestReport] = useState(false);
  const [rawErrorContent, setRawErrorContent] = useState<string | null>(null);
  const [isInvalidJson, setIsInvalidJson] = useState(false);

  // Helper function to get reports array from both old and new format
  const getReports = (): TestReport[] | null => {
    const testReports = artifact.manifest.test_reports;
    if (!testReports) return null;
    
    // Handle both old array format and new object format
    const reports = Array.isArray(testReports) ? testReports : testReports.reports;
    return reports || null;
  };

  // Test report status logic
  const getTestReportStatus = () => {
    const reports = getReports();
    if (!reports || reports.length === 0) return null;
    
    const passedCount = reports.filter(report => report.status === 'passed').length;
    const totalCount = reports.length;
    
    if (passedCount === totalCount) return 'all-passed';
    if (passedCount > 0) return 'some-passed';
    return 'none-passed';
  };

  const testReportStatus = getTestReportStatus();

  // Validation function to check if parsed JSON is a valid test report
  const isValidTestReport = (data: any): data is DetailedTestReport => {
    return (
      data &&
      typeof data === 'object' &&
      typeof data.name === 'string' &&
      typeof data.status === 'string' &&
      typeof data.source_name === 'string' &&
      typeof data.type === 'string' &&
      typeof data.format_version === 'string' &&
      typeof data.id === 'string' &&
      Array.isArray(data.details)
    );
  };

  const fetchDetailedTestReport = async () => {
    if (artifact.id) {
      try {
        setIsLoadingTestReport(true);
        setIsInvalidJson(false);
        setRawErrorContent(null);
        setDetailedTestReport(null);
        
        const testReportUrl = resolveHyphaUrl('test_reports.json', artifact.id, true);
        const response = await fetch(testReportUrl);
        const responseText = await response.text();
        
        try {
          const testReportData = JSON.parse(responseText);
          console.log('Parsed test report data:', testReportData);
          
          // Validate that the parsed data has the expected structure
          if (isValidTestReport(testReportData)) {
            console.log('Valid test report structure detected');
            setDetailedTestReport(testReportData);
            setIsInvalidJson(false);
          } else {
            console.log('Invalid test report structure detected, showing raw content');
            console.error('Invalid test report structure:', testReportData);
            setRawErrorContent(responseText);
            setIsInvalidJson(true);
          }
        } catch (jsonError) {
          console.error('Invalid JSON response:', jsonError);
          setRawErrorContent(responseText);
          setIsInvalidJson(true);
        }
        
        setIsDialogOpen(true);
      } catch (error) {
        console.error('Failed to fetch detailed test report:', error);
        setRawErrorContent('Failed to fetch test report data.');
        setIsInvalidJson(true);
        setIsDialogOpen(true);
      } finally {
        setIsLoadingTestReport(false);
      }
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (onStopPropagation) {
      e.stopPropagation();
    }
    
    if (showPopover) {
      setPopoverAnchorEl(e.currentTarget);
    } else {
      fetchDetailedTestReport();
    }
  };

  const handlePopoverClose = () => {
    setPopoverAnchorEl(null);
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
  };

  const popoverOpen = Boolean(popoverAnchorEl);

  if (!testReportStatus) return null;

  const getSizeConfig = () => {
    switch (size) {
      case 'small':
        return { width: 24, height: 24, iconSize: 14 };
      case 'large':
        return { width: 40, height: 40, iconSize: 22 };
      default:
        return { width: 32, height: 32, iconSize: 18 };
    }
  };

  const { width, height, iconSize } = getSizeConfig();

  const getIcon = () => {
    if (isLoadingTestReport) {
      return <CircularProgress size={iconSize} sx={{ color: 'white' }} />;
    }

    if (mode === 'inline') {
      return <InfoIcon sx={{ fontSize: iconSize, color: 'white', filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3))' }} />;
    }

    return testReportStatus === 'all-passed' ? (
      <CheckCircleIcon sx={{ fontSize: iconSize, color: 'white', filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3))' }} />
    ) : testReportStatus === 'some-passed' ? (
      <WarningIcon sx={{ fontSize: iconSize, color: 'white', filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3))' }} />
    ) : (
      <CancelIcon sx={{ fontSize: iconSize, color: 'white', filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3))' }} />
    );
  };

  const getBackground = () => {
    if (mode === 'inline') {
      return 'linear-gradient(135deg, #3b82f6, #6366f1)';
    }
    return testReportStatus === 'all-passed' 
      ? 'linear-gradient(135deg, #22c55e, #16a34a)' 
      : 'linear-gradient(135deg, #6b7280, #4b5563)';
  };

  const getHoverBackground = () => {
    if (mode === 'inline') {
      return 'linear-gradient(135deg, #2563eb, #4f46e5)';
    }
    return testReportStatus === 'all-passed' 
      ? 'linear-gradient(135deg, #16a34a, #15803d)' 
      : 'linear-gradient(135deg, #4b5563, #374151)';
  };

  const getShadow = () => {
    if (mode === 'inline') {
      return '0 4px 20px rgba(59, 130, 246, 0.4), 0 2px 8px rgba(0, 0, 0, 0.1)';
    }
    return testReportStatus === 'all-passed' 
      ? '0 4px 20px rgba(34, 197, 94, 0.4), 0 2px 8px rgba(0, 0, 0, 0.1)' 
      : '0 4px 20px rgba(107, 114, 128, 0.3), 0 2px 8px rgba(0, 0, 0, 0.1)';
  };

  const getHoverShadow = () => {
    if (mode === 'inline') {
      return '0 6px 25px rgba(59, 130, 246, 0.5), 0 4px 12px rgba(0, 0, 0, 0.15)';
    }
    return testReportStatus === 'all-passed' 
      ? '0 6px 25px rgba(34, 197, 94, 0.5), 0 4px 12px rgba(0, 0, 0, 0.15)' 
      : '0 6px 25px rgba(107, 114, 128, 0.4), 0 4px 12px rgba(0, 0, 0, 0.15)';
  };

  const getTooltipTitle = () => {
    if (mode === 'inline') {
      return showPopover ? 'Click for test report summary' : 'Click for detailed test report';
    }
    const reports = getReports();
    if (!reports) return 'No test reports available';
    
    return `Test Reports: ${reports.filter(r => r.status === 'passed').length || 0}/${reports.length || 0} passed`;
  };

  const getBadgeComponent = () => (
    <Tooltip title={getTooltipTitle()} placement={mode === 'floating' ? 'left' : 'top'}>
      <Box
        onClick={handleClick}
        sx={{ 
          ...(mode === 'floating' ? {
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 2,
          } : {
            position: 'relative',
          }),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width,
          height,
          cursor: isLoadingTestReport ? 'default' : 'pointer',
          background: getBackground(),
          backdropFilter: 'blur(12px)',
          border: testReportStatus === 'all-passed' || mode === 'inline'
            ? '1px solid rgba(255, 255, 255, 0.8)' 
            : '1px solid rgba(255, 255, 255, 0.6)',
          borderRadius: '50%',
          boxShadow: getShadow(),
          transition: 'all 0.3s ease',
          transform: 'translateZ(0)',
          '&:hover': !isLoadingTestReport ? {
            background: getHoverBackground(),
            borderColor: 'rgba(255, 255, 255, 0.6)',
            transform: 'translateY(-2px) scale(1.05)',
            boxShadow: getHoverShadow(),
          } : {},
        }}
      >
        {getIcon()}
      </Box>
    </Tooltip>
  );

  return (
    <>
      {getBadgeComponent()}

      {/* Popover for card view */}
      {showPopover && (
        <Popover
          open={popoverOpen}
          anchorEl={popoverAnchorEl}
          onClose={handlePopoverClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'right',
          }}
          sx={{
            '& .MuiPopover-paper': {
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '12px',
              boxShadow: '0 8px 25px rgba(0, 0, 0, 0.15)',
              maxWidth: 400,
              minWidth: 300,
            }
          }}
        >
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 500, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 1 }}>
              <AssignmentTurnedInIcon sx={{ fontSize: 20 }} />
              Test Reports
            </Typography>
            {(() => {
              const reports = getReports();
              return reports && reports.length > 0 && (
                <Stack spacing={1.5}>
                  {reports.map((testReport: TestReport, index: number) => (
                    <Box 
                      key={index}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePopoverClose();
                        fetchDetailedTestReport();
                      }}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 1.5,
                        p: 2,
                        backgroundColor: 'rgba(249, 250, 251, 0.8)',
                        backdropFilter: 'blur(4px)',
                        border: '1px solid rgba(255, 255, 255, 0.7)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          backgroundColor: 'rgba(255, 255, 255, 0.9)',
                          borderColor: testReport.status === 'passed' 
                            ? 'rgba(34, 197, 94, 0.3)' 
                            : 'rgba(107, 114, 128, 0.3)',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                        }
                      }}
                    >
                      {testReport.status === 'passed' ? (
                        <CheckCircleIcon 
                          sx={{ 
                            color: '#22c55e', 
                            fontSize: 18,
                            flexShrink: 0
                          }} 
                        />
                      ) : (
                        <CancelIcon 
                          sx={{ 
                            color: '#6b7280', 
                            fontSize: 18,
                            flexShrink: 0
                          }} 
                        />
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography 
                          variant="body2" 
                          sx={{ 
                            fontWeight: 500, 
                            color: '#1f2937',
                            lineHeight: 1.2,
                            wordBreak: 'break-word',
                            fontSize: '0.875rem'
                          }}
                        >
                          {testReport.name}
                        </Typography>
                        <Typography 
                          variant="caption" 
                          sx={{ 
                            color: '#6b7280',
                            fontSize: '0.75rem',
                            display: 'block',
                            mt: 0.5
                          }}
                        >
                          {testReport.runtime}
                        </Typography>
                      </Box>
                      <Chip
                        label={testReport.status}
                        size="small"
                        sx={{
                          backgroundColor: testReport.status === 'passed' 
                            ? 'rgba(34, 197, 94, 0.1)' 
                            : 'rgba(107, 114, 128, 0.1)',
                          color: testReport.status === 'passed' 
                            ? '#22c55e' 
                            : '#6b7280',
                          borderRadius: '6px',
                          fontWeight: 500,
                          fontSize: '0.7rem',
                          height: 20,
                          border: `1px solid ${testReport.status === 'passed' 
                            ? 'rgba(34, 197, 94, 0.2)' 
                            : 'rgba(107, 114, 128, 0.2)'}`,
                          textTransform: 'capitalize',
                          flexShrink: 0
                        }}
                      />
                    </Box>
                  ))}
                </Stack>
              );
            })()}
          </Box>
        </Popover>
      )}

      {/* Dialog for details view */}
      <TestReportDialog
        open={isDialogOpen}
        onClose={handleDialogClose}
        testReport={detailedTestReport}
        isLoading={isLoadingTestReport}
        rawErrorContent={rawErrorContent}
        isInvalidJson={isInvalidJson}
      />
    </>
  );
};

export default TestReportBadge; 