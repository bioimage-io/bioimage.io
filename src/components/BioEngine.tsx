import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import { Card, CardContent, CardMedia, Button, IconButton, Box, Typography, Chip, Grid, Dialog, DialogTitle, DialogContent } from '@mui/material';

type ServiceStatus = {
  service: {
    start_time: string;
    uptime: string;
  };
  cluster: {
    head_address: string;
    worker_nodes: {
      Alive: Array<{
        WorkerID: string | null;
        NodeID: string;
        NodeIP: string;
        "Total GPU": number;
        "Available GPU": number;
        "GPU Utilization": number;
        "Total CPU": number;
        "Available CPU": number;
        "CPU Utilization": number;
        "Total Memory": number;
        "Available Memory": number;
        "Memory Utilization": number;
      }>;
      Dead: Array<any>;
    };
    start_time: string;
    uptime: string;
    autoscaler: any;
    note: string;
  };
  deployments: {
    service_id: string;
    [key: string]: any;
  };
};

type BioEngineService = {
  id: string;
  name: string;
  description: string;
};

const BioEngine: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const serviceId = searchParams.get('service_id');
  
  const { server, isLoggedIn } = useHyphaStore();
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [bioEngineServices, setBioEngineServices] = useState<BioEngineService[]>([]);
  
  // Placeholder for available artifacts
  const [availableArtifacts] = useState([
    { id: 'artifact1', name: 'Example Artifact 1' },
    { id: 'artifact2', name: 'Example Artifact 2' },
    { id: 'artifact3', name: 'Example Artifact 3' },
  ]);

  useEffect(() => {
    if (!isLoggedIn) {
      setError('Please log in to view BioEngine instances');
      setLoading(false);
      return;
    }

    if (serviceId) {
      fetchStatus();
    } else {
      fetchBioEngineServices();
    }
  }, [serviceId, server, isLoggedIn]);

  const fetchBioEngineServices = async () => {
    if (!isLoggedIn) return;

    try {
      setLoading(true);
      const services = await server.listServices({"type": "bioengine-worker"});
      setBioEngineServices(services);
      setLoading(false);
      setError(null);
    } catch (err) {
      setError(`Failed to fetch BioEngine instances: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    if (!serviceId || !isLoggedIn) {
      setError(serviceId ? 'Please log in to view BioEngine status' : 'No service ID provided');
      setLoading(false);
      return;
    }

    try {
      const bioengineWorker = await server.getService(serviceId);
      const statusData = await bioengineWorker.get_status();
      setError(null);
      setStatus(statusData);
      setLoading(false);
    } catch (err) {
      setError(`Failed to fetch BioEngine status: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  };

  const handleDeployArtifact = (artifactId: string) => {
    // Placeholder for deploy function
    console.log(`Deploying artifact: ${artifactId} to BioEngine ${serviceId}`);
    setIsDialogOpen(false);
  };

  const navigateToDashboard = (serviceId: string) => {
    navigate(`/bioengine?service_id=${serviceId}`);
  };

  if (loading) {
    return <div className="flex justify-center items-center h-96">Loading...</div>;
  }

  if (error) {
    return <div className="flex justify-center items-center h-96 text-red-500">{error}</div>;
  }

  // If no service_id is provided, show the list of BioEngine instances
  if (!serviceId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">BioEngine Instances</h1>
        
        {bioEngineServices.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <p className="mb-4">No BioEngine instances available</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {bioEngineServices.map((service) => (
              <Card key={service.id} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flexGrow: 1 }}>
                  <Typography variant="h5" component="div" gutterBottom>
                    {service.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {service.description || 'No description available'}
                  </Typography>
                  <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1 }}>
                    ID: {service.id}
                  </Typography>
                </CardContent>
                <Box sx={{ p: 2, pt: 0 }}>
                  <Button 
                    variant="contained" 
                    fullWidth
                    onClick={() => navigateToDashboard(service.id)}
                  >
                    View Dashboard
                  </Button>
                </Box>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!status) {
    return <div className="flex justify-center items-center h-96">No status data available</div>;
  }

  // Extract deployment information
  const deployments = Object.entries(status.deployments)
    .filter(([key]) => key !== 'service_id')
    .map(([key, value]) => ({ name: key, ...value }));

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">BioEngine Dashboard</h1>
      
      {/* Service Status */}
      <Grid container spacing={3} className="mb-6">
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Service Information</Typography>
              <Box sx={{ mt: 2 }}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body1" fontWeight="medium">Start Time:</Typography>
                  <Typography variant="body1">{status.service.start_time}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="body1" fontWeight="medium">Uptime:</Typography>
                  <Typography variant="body1">{status.service.uptime}</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Cluster Information</Typography>
              <Box sx={{ mt: 2 }}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body1" fontWeight="medium">Head Address:</Typography>
                  <Typography variant="body1">{status.cluster.head_address}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body1" fontWeight="medium">Start Time:</Typography>
                  <Typography variant="body1">{status.cluster.start_time}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="body1" fontWeight="medium">Uptime:</Typography>
                  <Typography variant="body1">{status.cluster.uptime}</Typography>
                </Box>
                {status.cluster.note && (
                  <Box mt={2}>
                    <Typography variant="body2" color="text.secondary">Note: {status.cluster.note}</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      
      {/* Worker Nodes */}
      <Card className="mb-6">
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Worker Nodes</Typography>
          </Box>
          <div className="overflow-x-auto">
            <table className="w-full table-auto">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-2 text-left">Node IP</th>
                  <th className="px-4 py-2 text-left">Node ID</th>
                  <th className="px-4 py-2 text-left">CPU</th>
                  <th className="px-4 py-2 text-left">GPU</th>
                  <th className="px-4 py-2 text-left">Memory</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {status.cluster.worker_nodes.Alive.map((node, index) => (
                  <tr key={index} className="border-b">
                    <td className="px-4 py-2">{node.NodeIP}</td>
                    <td className="px-4 py-2 truncate max-w-[150px]" title={node.NodeID}>
                      {node.NodeID.substring(0, 8)}...
                    </td>
                    <td className="px-4 py-2">
                      {node["Available CPU"]}/{node["Total CPU"]} ({node["CPU Utilization"]}%)
                    </td>
                    <td className="px-4 py-2">
                      {node["Available GPU"]}/{node["Total GPU"]} ({node["GPU Utilization"]}%)
                    </td>
                    <td className="px-4 py-2">
                      {(node["Available Memory"] / 1024 / 1024 / 1024).toFixed(2)}GB/
                      {(node["Total Memory"] / 1024 / 1024 / 1024).toFixed(2)}GB
                      ({node["Memory Utilization"]}%)
                    </td>
                    <td className="px-4 py-2">
                      <Chip label="Alive" color="success" size="small" />
                    </td>
                  </tr>
                ))}
                {status.cluster.worker_nodes.Dead.map((node, index) => (
                  <tr key={`dead-${index}`} className="border-b">
                    <td className="px-4 py-2" colSpan={5}>
                      {JSON.stringify(node)}
                    </td>
                    <td className="px-4 py-2">
                      <Chip label="Dead" color="error" size="small" />
                    </td>
                  </tr>
                ))}
                {status.cluster.worker_nodes.Alive.length === 0 && 
                 status.cluster.worker_nodes.Dead.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-2 text-center">No worker nodes available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      
      {/* Deployments */}
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Deployed Artifacts</Typography>
            <Button 
              variant="outlined"
              onClick={() => setIsDialogOpen(true)}
            >
              Add Deployment
            </Button>
          </Box>
          
          {deployments.length > 0 ? (
            <div className="space-y-4">
              {deployments.map((deployment, index) => (
                <Box key={index} p={2} border={1} borderRadius={1} borderColor="divider">
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="subtitle1" fontWeight="medium">{deployment.name}</Typography>
                    <Chip
                      label={deployment.status}
                      color={deployment.status === "RUNNING" ? "success" : "default"}
                      size="small"
                    />
                  </Box>
                  <Grid container spacing={1}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2">
                        <span style={{ fontWeight: 500 }}>Artifact ID:</span> {deployment.artifact_id}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2">
                        <span style={{ fontWeight: 500 }}>Last Deployed:</span> {deployment.last_deployed_at}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2">
                        <span style={{ fontWeight: 500 }}>Duration:</span> {deployment.duration_since}
                      </Typography>
                    </Grid>
                    {deployment.ChironModel && (
                      <Grid item xs={12} md={6}>
                        <Box display="flex" alignItems="center">
                          <Typography variant="body2" style={{ fontWeight: 500 }} mr={1}>
                            ChironModel Status:
                          </Typography>
                          <Chip
                            label={deployment.ChironModel.status}
                            color={deployment.ChironModel.status === "HEALTHY" ? "success" : "warning"}
                            size="small"
                          />
                        </Box>
                      </Grid>
                    )}
                  </Grid>
                </Box>
              ))}
            </div>
          ) : (
            <Box textAlign="center" py={4}>
              <Typography variant="body1" color="text.secondary">No deployments found</Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Dialog for available artifacts */}
      <Dialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        aria-labelledby="artifacts-dialog-title"
      >
        <DialogTitle id="artifacts-dialog-title">Available Artifacts</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, pb: 2 }}>
            {availableArtifacts.map((artifact) => (
              <Box 
                key={artifact.id} 
                display="flex" 
                justifyContent="space-between" 
                alignItems="center" 
                p={1.5} 
                mb={1}
                border={1}
                borderRadius={1}
                borderColor="divider"
              >
                <Typography>{artifact.name}</Typography>
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => handleDeployArtifact(artifact.id)}
                >
                  Deploy
                </Button>
              </Box>
            ))}
          </Box>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BioEngine; 