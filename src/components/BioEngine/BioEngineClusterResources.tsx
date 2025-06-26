import React, { useState } from 'react';

interface ClusterData {
  head_address: string;
  start_time: number | "N/A";
  mode: string;
  cluster: {
    total_gpu: number;
    available_gpu: number;
    total_cpu: number;
    available_cpu: number;
    total_memory: number;
    available_memory: number;
    total_object_store_memory: number;
    available_object_store_memory: number;
    pending_resources: {
      actors: any[];
      jobs: any[];
      tasks: any[];
      total: number;
    };
  };
  nodes: Record<string, {
    node_ip: string;
    total_cpu: number;
    available_cpu: number;
    total_gpu: number;
    available_gpu: number;
    total_memory: number;
    available_memory: number;
    total_object_store_memory: number;
    available_object_store_memory: number;
    accelerator_type?: string;
    slurm_job_id?: string;
  }>;
}

interface BioEngineClusterResourcesProps {
  rayCluster: ClusterData;
  currentTime: number;
  formatTimeInfo: (timestamp: number) => { formattedTime: string, uptime: string };
}

const BioEngineClusterResources: React.FC<BioEngineClusterResourcesProps> = ({ rayCluster, currentTime, formatTimeInfo }) => {
  const [nodesExpanded, setNodesExpanded] = useState(false);
  const [pendingExpanded, setPendingExpanded] = useState(false);

  if (!rayCluster?.cluster) return null;

  const formatBytes = (bytes: number) => {
    return (bytes / 1024 / 1024 / 1024).toFixed(1);
  };

  const ResourceBar: React.FC<{ available: number; total: number; color: string; unit?: string }> = ({ available, total, color, unit = "" }) => {
    const used = total - available;
    const displayUsed = unit === "GB" ? formatBytes(used) : used;
    const displayTotal = unit === "GB" ? formatBytes(total) : total;

    if (total === 0) {
      return (
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-700 w-20">0{unit} / 0{unit}</span>
          <div className="flex-1 bg-gray-200 rounded-full h-2">
            <div className="bg-gray-300 h-2 rounded-full w-full"></div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center space-x-2">
        <span className="text-sm font-medium text-gray-700 w-20">{displayUsed}{unit} / {displayTotal}{unit}</span>
        <div className="flex-1 bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${color}`}
            style={{ width: `${(used / total) * 100}%` }}
          ></div>
        </div>
      </div>
    );
  };

  const ResourceCard: React.FC<{
    title: string;
    available: number;
    total: number;
    color: string;
    bgColor: string;
    unit?: string;
  }> = ({ title, available, total, color, bgColor, unit = "" }) => {
    const used = total - available;
    const percentage = total > 0 ? Math.round((used / total) * 100) : 0;
    const displayUsed = unit === "GB" ? formatBytes(used) : used;
    const displayTotal = unit === "GB" ? formatBytes(total) : total;

    return (
      <div className={`${bgColor} rounded-xl p-4`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-sm font-medium ${color.replace('bg-', 'text-')}`}>{title}</span>
          <span className={`text-xs ${color.replace('bg-', 'text-').replace('600', '500')}`}>
            {percentage}% used
          </span>
        </div>
        <div className={`text-lg font-bold ${color.replace('bg-', 'text-').replace('600', '800')} mb-2`}>
          {displayUsed}{unit} / {displayTotal}{unit}
        </div>
        <div className={`w-full ${color.replace('bg-', 'bg-').replace('600', '200')} rounded-full h-2`}>
          <div
            className={`${color} h-2 rounded-full transition-all duration-300`}
            style={{ width: total > 0 ? `${percentage}%` : '0%' }}
          ></div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 mb-8 hover:shadow-md transition-all duration-200">
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-green-600 rounded-xl flex items-center justify-center mr-3">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2v-8a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-800">Cluster Resources</h3>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {/* CPU Usage */}
          <ResourceCard
            title="CPU Cores"
            available={rayCluster.cluster.available_cpu}
            total={rayCluster.cluster.total_cpu}
            color="bg-blue-600"
            bgColor="bg-gradient-to-br from-blue-50 to-blue-100"
          />

          {/* GPU Usage */}
          <ResourceCard
            title="GPU Cards"
            available={rayCluster.cluster.available_gpu}
            total={rayCluster.cluster.total_gpu}
            color="bg-purple-600"
            bgColor="bg-gradient-to-br from-purple-50 to-purple-100"
          />

          {/* Memory Usage */}
          <ResourceCard
            title="Memory"
            available={rayCluster.cluster.available_memory}
            total={rayCluster.cluster.total_memory}
            color="bg-orange-600"
            bgColor="bg-gradient-to-br from-orange-50 to-orange-100"
            unit="GB"
          />

          {/* Object Store Memory Usage */}
          <ResourceCard
            title="Object Store"
            available={rayCluster.cluster.available_object_store_memory}
            total={rayCluster.cluster.total_object_store_memory}
            color="bg-teal-600"
            bgColor="bg-gradient-to-br from-teal-50 to-teal-100"
            unit="GB"
          />
        </div>

        {/* Expandable Pending Resources Section */}
        {rayCluster.cluster.pending_resources && (
          <div className="border-t border-gray-200 pt-6 mb-6">
            <button
              onClick={() => setPendingExpanded(!pendingExpanded)}
              className="flex items-center justify-between w-full text-left p-3 bg-yellow-50 rounded-xl hover:bg-yellow-100 transition-colors duration-200"
            >
              <div className="flex items-center">
                <svg className="w-5 h-5 text-yellow-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium text-yellow-800">
                  Pending Resources (Total: {rayCluster.cluster.pending_resources.total})
                </span>
              </div>
              <svg
                className={`w-5 h-5 text-yellow-600 transition-transform duration-200 ${pendingExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {pendingExpanded && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 animate-slideUp">
                <div className="bg-white border border-yellow-200 rounded-xl p-4">
                  <div className="flex items-center mb-2">
                    <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                    <span className="font-medium text-gray-800">Actors</span>
                  </div>
                  <div className="text-lg font-bold text-yellow-700">
                    {rayCluster.cluster.pending_resources.actors.length}
                  </div>
                </div>
                <div className="bg-white border border-yellow-200 rounded-xl p-4">
                  <div className="flex items-center mb-2">
                    <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                    <span className="font-medium text-gray-800">Jobs</span>
                  </div>
                  <div className="text-lg font-bold text-yellow-700">
                    {rayCluster.cluster.pending_resources.jobs.length}
                  </div>
                </div>
                <div className="bg-white border border-yellow-200 rounded-xl p-4">
                  <div className="flex items-center mb-2">
                    <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                    <span className="font-medium text-gray-800">Tasks</span>
                  </div>
                  <div className="text-lg font-bold text-yellow-700">
                    {rayCluster.cluster.pending_resources.tasks.length}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expandable Nodes Section */}
        {rayCluster.nodes && Object.keys(rayCluster.nodes).length > 0 && (
          <div className="border-t border-gray-200 pt-6">
            <button
              onClick={() => setNodesExpanded(!nodesExpanded)}
              className="flex items-center justify-between w-full text-left p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors duration-200"
            >
              <div className="flex items-center">
                <svg className="w-5 h-5 text-gray-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
                <span className="font-medium text-gray-700">
                  Worker Nodes ({Object.keys(rayCluster.nodes).length})
                </span>
              </div>
              <svg
                className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${nodesExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {nodesExpanded && (
              <div className="mt-4 space-y-3 animate-slideUp">
                {Object.entries(rayCluster.nodes).map(([nodeId, node], index) => (
                  <div key={nodeId} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-1">
                        <div className="flex items-center mb-3">
                          <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                          <span className="font-medium text-gray-800">
                            Node {index + 1}
                          </span>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex flex-col">
                            <span className="text-gray-600">Node ID:</span>
                            <span className="text-gray-900 font-mono text-xs break-all" title={nodeId}>
                              {nodeId}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">IP Address:</span>
                            <span className="text-gray-900 font-mono">{node.node_ip}</span>
                          </div>
                          {node.accelerator_type && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Accelerator Type:</span>
                              <span className="text-gray-900 font-semibold">{node.accelerator_type}</span>
                            </div>
                          )}
                          {node.slurm_job_id && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">SLURM Job ID:</span>
                              <span className="text-gray-900 font-mono">{node.slurm_job_id}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="lg:col-span-2">
                        <h4 className="font-medium text-gray-700 mb-3">Resource Usage</h4>
                        <div className="space-y-3 text-sm">
                          <div>
                            <span className="text-gray-600 text-xs">CPU Cores</span>
                            <ResourceBar
                              available={node.available_cpu}
                              total={node.total_cpu}
                              color="bg-blue-600"
                            />
                          </div>
                          <div>
                            <span className="text-gray-600 text-xs">GPU Cards</span>
                            <ResourceBar
                              available={node.available_gpu}
                              total={node.total_gpu}
                              color="bg-purple-600"
                            />
                          </div>
                          <div>
                            <span className="text-gray-600 text-xs">Memory</span>
                            <ResourceBar
                              available={node.available_memory}
                              total={node.total_memory}
                              color="bg-orange-600"
                              unit="GB"
                            />
                          </div>
                          <div>
                            <span className="text-gray-600 text-xs">Object Store</span>
                            <ResourceBar
                              available={node.available_object_store_memory}
                              total={node.total_object_store_memory}
                              color="bg-teal-600"
                              unit="GB"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BioEngineClusterResources;
