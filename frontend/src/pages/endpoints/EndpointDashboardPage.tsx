import { Link } from 'react-router-dom';
import { Cpu, Server, Package, Activity, ArrowRight } from 'lucide-react';
import { useAppSelector } from '../../store';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/shared/ui/Card';

export default function EndpointDashboardPage() {
  const { currentOrg } = useAppSelector((state) => state.endpointAuth);

  const quickLinks = [
    {
      title: 'Sensors',
      description: 'View and manage connected endpoints',
      icon: Server,
      path: '/endpoints/sensors',
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Payloads',
      description: 'Upload and deploy files to endpoints',
      icon: Package,
      path: '/endpoints/payloads',
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
    {
      title: 'Events',
      description: 'Query and view endpoint events',
      icon: Activity,
      path: '/endpoints/events',
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <div className="p-3 rounded-lg bg-primary/10">
            <Cpu className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Endpoint Management</h1>
            <p className="text-muted-foreground">
              {currentOrg ? `Organization: ${currentOrg.name || currentOrg.oid}` : 'LimaCharlie Endpoint Control'}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Links Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {quickLinks.map((link) => (
          <Link key={link.path} to={link.path}>
            <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer group">
              <CardContent className="pt-6">
                <div className={`p-3 rounded-lg ${link.bgColor} w-fit mb-4`}>
                  <link.icon className={`w-6 h-6 ${link.color}`} />
                </div>
                <h3 className="text-lg font-semibold mb-1 group-hover:text-primary transition-colors">
                  {link.title}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {link.description}
                </p>
                <div className="flex items-center gap-1 text-sm text-primary">
                  Open
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Getting Started */}
      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">
                1
              </div>
              <div>
                <p className="font-medium">View Sensors</p>
                <p className="text-sm text-muted-foreground">
                  Browse connected endpoints and their status in the Sensors page
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">
                2
              </div>
              <div>
                <p className="font-medium">Upload Payloads</p>
                <p className="text-sm text-muted-foreground">
                  Upload files to the Payloads storage for deployment to endpoints
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">
                3
              </div>
              <div>
                <p className="font-medium">Execute Commands</p>
                <p className="text-sm text-muted-foreground">
                  Run commands or deploy payloads to selected endpoints
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
