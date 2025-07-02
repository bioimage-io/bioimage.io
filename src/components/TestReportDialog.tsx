import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Typography,
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Stack,
  Alert,
  Paper,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DetailedTestReport } from '../types/artifact';

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
  // Debug logging
  React.useEffect(() => {
    if (open) {
      console.log('TestReportDialog opened with props:', {
        isLoading,
        isInvalidJson,
        hasTestReport: !!testReport,
        hasRawErrorContent: !!rawErrorContent,
        testReport: testReport ? 'Valid object' : 'null/undefined'
      });
    }
  }, [open, isLoading, isInvalidJson, testReport, rawErrorContent]);
  const getStatusIcon = (status: string) => {
    return status === 'passed' ? (
      <CheckCircleIcon sx={{ color: '#22c55e', fontSize: 20 }} />
    ) : (
      <CancelIcon sx={{ color: '#ef4444', fontSize: 20 }} />
    );
  };

  const getStatusColor = (status: string) => {
    return status === 'passed' ? '#22c55e' : '#ef4444';
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '16px',
          maxHeight: '90vh',
        }
      }}
    >
      <DialogTitle 
        sx={{ 
          m: 0, 
          p: 3, 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.3)',
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 300, color: '#1f2937' }}>
          Detailed Test Report
        </Typography>
        <IconButton
          onClick={onClose}
          aria-label="close"
          sx={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '12px',
            color: '#dc2626',
            '&:hover': {
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent dividers sx={{ p: 0 }}>
        {isLoading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography>Loading test report details...</Typography>
          </Box>
        ) : isInvalidJson ? (
          <Box sx={{ p: 3 }}>
            <Stack spacing={3} alignItems="center" sx={{ py: 4 }}>
              <ErrorIcon color="error" sx={{ fontSize: 48 }} />
              <Typography variant="h6" sx={{ fontWeight: 500, color: '#ef4444' }}>
                Invalid Test Report
              </Typography>
              <Typography color="text.secondary" align="center">
                The test report data is invalid or corrupted. The raw response is shown below.
              </Typography>
            </Stack>
            
            <Paper
              sx={{
                p: 3,
                backgroundColor: 'rgba(249, 250, 251, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.5)',
                borderRadius: '12px',
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 2, color: '#1f2937' }}>
                Raw Response:
              </Typography>
              <Box
                sx={{
                  p: 2,
                  backgroundColor: 'rgba(0, 0, 0, 0.05)',
                  borderRadius: '8px',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                  maxHeight: 400,
                  overflow: 'auto',
                }}
              >
                <pre style={{ 
                  margin: 0, 
                  fontSize: '0.875rem', 
                  lineHeight: 1.4,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                }}>
                  {rawErrorContent || 'No raw content available'}
                </pre>
              </Box>
            </Paper>
          </Box>
        ) : testReport ? (
          <Box sx={{ p: 3 }}>
            {/* Report Header */}
            <Paper
              sx={{
                p: 3,
                mb: 3,
                backgroundColor: 'rgba(249, 250, 251, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.5)',
                borderRadius: '12px',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                {getStatusIcon(testReport.status)}
                <Typography variant="h6" sx={{ fontWeight: 500 }}>
                  {testReport.name}
                </Typography>
                <Chip
                  label={testReport.status}
                  sx={{
                    backgroundColor: testReport.status === 'passed' 
                      ? 'rgba(34, 197, 94, 0.1)' 
                      : 'rgba(239, 68, 68, 0.1)',
                    color: getStatusColor(testReport.status),
                    borderRadius: '8px',
                    fontWeight: 500,
                    border: `1px solid ${testReport.status === 'passed' 
                      ? 'rgba(34, 197, 94, 0.2)' 
                      : 'rgba(239, 68, 68, 0.2)'}`,
                  }}
                />
              </Box>
              
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  <strong>Source:</strong> {testReport.source_name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  <strong>Type:</strong> {testReport.type}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  <strong>Format Version:</strong> {testReport.format_version}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  <strong>ID:</strong> {testReport.id}
                </Typography>
              </Stack>
            </Paper>

            {/* Test Details */}
            {testReport.details && testReport.details.length > 0 && (
              <>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 500 }}>
                  Test Details ({testReport.details.length} tests)
                </Typography>
                
                <Stack spacing={2}>
                  {testReport.details.map((detail, index) => (
                <Accordion
                  key={index}
                  sx={{
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.5)',
                    borderRadius: '12px !important',
                    '&:before': { display: 'none' },
                    '&.Mui-expanded': {
                      borderColor: detail.status === 'passed' 
                        ? 'rgba(34, 197, 94, 0.3)' 
                        : 'rgba(239, 68, 68, 0.3)',
                    }
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    sx={{
                      borderRadius: '12px',
                      '&.Mui-expanded': {
                        borderBottomLeftRadius: '0',
                        borderBottomRightRadius: '0',
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                      {getStatusIcon(detail.status)}
                      <Typography sx={{ fontWeight: 500, flex: 1 }}>
                        {detail.name}
                      </Typography>
                      <Chip
                        label={detail.status}
                        size="small"
                        sx={{
                          backgroundColor: detail.status === 'passed' 
                            ? 'rgba(34, 197, 94, 0.1)' 
                            : 'rgba(239, 68, 68, 0.1)',
                          color: getStatusColor(detail.status),
                          borderRadius: '8px',
                          fontWeight: 500,
                          border: `1px solid ${detail.status === 'passed' 
                            ? 'rgba(34, 197, 94, 0.2)' 
                            : 'rgba(239, 68, 68, 0.2)'}`,
                        }}
                      />
                    </Box>
                  </AccordionSummary>
                  
                  <AccordionDetails sx={{ pt: 0 }}>
                    {/* Location */}
                    {detail.loc && detail.loc.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 1 }}>
                          Location:
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {detail.loc.map((loc, locIndex) => (
                            <Chip
                              key={locIndex}
                              label={loc}
                              size="small"
                              sx={{
                                backgroundColor: 'rgba(249, 250, 251, 0.8)',
                                border: '1px solid rgba(255, 255, 255, 0.5)',
                                borderRadius: '8px',
                              }}
                            />
                          ))}
                        </Box>
                      </Box>
                    )}

                    {/* Errors */}
                    {detail.errors && detail.errors.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 1 }}>
                          Errors ({detail.errors.length}):
                        </Typography>
                        <Stack spacing={2}>
                          {detail.errors.map((error, errorIndex) => (
                            <Alert
                              key={errorIndex}
                              severity="error"
                              sx={{
                                backgroundColor: 'rgba(239, 68, 68, 0.05)',
                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                borderRadius: '12px',
                              }}
                            >
                              <Box>
                                <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
                                  {error.type}
                                </Typography>
                                <Typography variant="body2" sx={{ mb: 1 }}>
                                  {error.msg}
                                </Typography>
                                
                                {error.loc && error.loc.length > 0 && (
                                  <Box sx={{ mb: 1 }}>
                                    <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                      Location: 
                                    </Typography>
                                    <Typography variant="caption">
                                      {error.loc.join(' → ')}
                                    </Typography>
                                  </Box>
                                )}
                                
                                {error.traceback_md && (
                                  <Box
                                    sx={{
                                      mt: 2,
                                      p: 2,
                                      backgroundColor: 'rgba(0, 0, 0, 0.05)',
                                      borderRadius: '8px',
                                      border: '1px solid rgba(0, 0, 0, 0.1)',
                                      '& pre': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                        color: 'white',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        overflow: 'auto',
                                        fontSize: '0.875rem',
                                        lineHeight: 1.4,
                                      },
                                      '& code': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                        padding: '2px 4px',
                                        borderRadius: '4px',
                                        fontSize: '0.875rem',
                                      }
                                    }}
                                  >
                                    <Typography variant="caption" sx={{ fontWeight: 500, display: 'block', mb: 1 }}>
                                      Traceback:
                                    </Typography>
                                    <pre>
                                      {error.traceback_md}
                                    </pre>
                                  </Box>
                                )}
                              </Box>
                            </Alert>
                          ))}
                        </Stack>
                      </Box>
                    )}

                    {/* Warnings */}
                    {detail.warnings && detail.warnings.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 1 }}>
                          <WarningIcon sx={{ fontSize: 'small', mr: 0.5, verticalAlign: 'middle' }} />
                          Warnings ({detail.warnings.length}):
                        </Typography>
                        <Stack spacing={1}>
                          {detail.warnings.map((warning, warningIndex) => (
                            <Alert
                              key={warningIndex}
                              severity="warning"
                              sx={{
                                backgroundColor: 'rgba(245, 158, 11, 0.05)',
                                border: '1px solid rgba(245, 158, 11, 0.2)',
                                borderRadius: '8px',
                              }}
                            >
                              <Typography variant="body2">
                                {typeof warning === 'string' ? warning : JSON.stringify(warning)}
                              </Typography>
                            </Alert>
                          ))}
                        </Stack>
                      </Box>
                    )}

                    {/* Recommended Environment */}
                    {detail.recommended_env && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 500, mb: 1 }}>
                          Recommended Environment:
                        </Typography>
                        <Paper
                          sx={{
                            p: 2,
                            backgroundColor: 'rgba(249, 250, 251, 0.8)',
                            border: '1px solid rgba(255, 255, 255, 0.5)',
                            borderRadius: '8px',
                          }}
                        >
                          <pre style={{ margin: 0, fontSize: '0.875rem', overflow: 'auto' }}>
                            {JSON.stringify(detail.recommended_env, null, 2)}
                          </pre>
                        </Paper>
                      </Box>
                    )}
                  </AccordionDetails>
                </Accordion>
              ))}
                </Stack>
              </>
            )}

            {/* Environment Information */}
            {testReport.env && testReport.env.length > 0 && (
              <Box sx={{ mt: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 500 }}>
                  Environment
                </Typography>
                <Paper
                  sx={{
                    p: 2,
                    backgroundColor: 'rgba(249, 250, 251, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.5)',
                    borderRadius: '12px',
                  }}
                >
                  <Stack spacing={1}>
                    {testReport.env.map((envItem, index) => (
                      <Typography key={index} variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {envItem[0]} = {envItem[1]}
                      </Typography>
                    ))}
                  </Stack>
                </Paper>
              </Box>
            )}
          </Box>
        ) : (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography>No test report data available</Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TestReportDialog; 