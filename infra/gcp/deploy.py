#!/usr/bin/env python3
"""Explicit, project-locked deployment. Default is a mutation-free plan.
Never log command arguments or captured provider output: they can contain secrets.
"""
import argparse,json,os,re,secrets,shutil,subprocess,tempfile
from pathlib import Path
from urllib.parse import urlparse
PROJECT='ecommerce-platform-510208'
APIS=['run.googleapis.com','artifactregistry.googleapis.com','sqladmin.googleapis.com','secretmanager.googleapis.com','iam.googleapis.com','logging.googleapis.com','monitoring.googleapis.com']
ROOT=Path(__file__).resolve().parents[2]

def run(args,stdin=None):
    result=subprocess.run(args,input=stdin,text=True,capture_output=True)
    if result.returncode: raise RuntimeError('Command failed: '+args[0]+' '+args[1]+'; provider output withheld to avoid secret disclosure. Inspect this operation in the cloud console.')
    return result.stdout.strip()

def cloud(*args,stdin=None):
    return run(['gcloud',*args,'--project='+PROJECT,'--quiet'],stdin)

def listed(*args): return json.loads(cloud(*args,'--format=json'))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--region',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if not re.fullmatch(r'[a-z]+-[a-z]+[0-9]+',args.region): raise RuntimeError('Invalid region')
    print('Project: '+PROJECT+'; region: '+args.region)
    print('Plan: account/project preflight; required APIs; Artifact Registry; identity; Cloud SQL 17; Secret Manager; image build/push; migration job; private Cloud Run API.')
    if not args.apply:
        print('Plan only. No cloud calls or mutations. Live deployment requires gcloud login and externally reachable OIDC/payment/Redis configuration.');return
    if not shutil.which('gcloud'): raise RuntimeError('gcloud not installed; install Google Cloud CLI, then run gcloud auth login')
    active=run(['gcloud','auth','list','--filter=status:ACTIVE','--format=value(account)'])
    if not active: raise RuntimeError('No active account; run gcloud auth login')
    selected=run(['gcloud','config','get-value','project'])
    if selected!=PROJECT: run(['gcloud','config','set','project',PROJECT])
    # Validate external dependencies before provisioning billable resources.
    issuer=os.environ.get('OIDC_ISSUER','');provider=os.environ.get('PAYMENT_PROVIDER_BASE_URL','');redis=os.environ.get('REDIS_URL','')
    for label,value in [('OIDC_ISSUER',issuer),('PAYMENT_PROVIDER_BASE_URL',provider)]:
        url=urlparse(value)
        if url.scheme!='https' or not url.hostname or url.hostname in ['localhost','127.0.0.1','keycloak','payment-provider'] or url.username or url.password or url.query or url.fragment:
            raise RuntimeError(label+' must identify a reachable production HTTPS service')
    if issuer.endswith('/'): raise RuntimeError('OIDC_ISSUER must not end in /')
    if urlparse(redis).scheme not in ['redis','rediss'] or not urlparse(redis).hostname or urlparse(redis).hostname in ['localhost','127.0.0.1','redis-cache']:
        raise RuntimeError('REDIS_URL must reference reachable external infrastructure; no local Docker endpoint')
    audience=os.environ.get('OIDC_AUDIENCE','ecommerce-api')
    if not audience or any(c.isspace() for c in audience): raise RuntimeError('Invalid OIDC_AUDIENCE')
    webhook=os.environ.get('PAYMENT_WEBHOOK_SECRET','')
    if len(webhook)<32 or webhook.startswith('REPLACE_'): raise RuntimeError('Supply the real external provider shared webhook secret privately')
    cloud('services','enable',*APIS)
    repository='ecommerce';instance='ecommerce-postgres';service='ecommerce-api';database='ecommerce';user='ecommerce_app'
    account=service+'@'+PROJECT+'.iam.gserviceaccount.com'
    if not any(x['name'].endswith('/'+repository) for x in listed('artifacts','repositories','list','--location='+args.region)):
        cloud('artifacts','repositories','create',repository,'--repository-format=docker','--location='+args.region)
    if not any(x['email']==account for x in listed('iam','service-accounts','list')):
        cloud('iam','service-accounts','create',service,'--display-name=Ecommerce API')
    instances=listed('sql','instances','list');existing=next((x for x in instances if x['name']==instance),None)
    if existing and (existing['region']!=args.region or not existing['databaseVersion'].startswith('POSTGRES_')):
        raise RuntimeError('Existing SQL instance region/engine differs; refusing to replace it')
    if not existing:
        cloud('sql','instances','create',instance,'--database-version=POSTGRES_17','--edition=ENTERPRISE','--tier=db-f1-micro','--region='+args.region,'--storage-size=10','--backup-start-time=03:00','--deletion-protection')
    if not any(x['name']==database for x in listed('sql','databases','list','--instance='+instance)):
        cloud('sql','databases','create',database,'--instance='+instance)
    known={x['name'].split('/')[-1] for x in listed('secrets','list')}
    def secret(name,value,compare=False):
        if name in known:
            stored=cloud('secrets','versions','access','latest','--secret='+name)
            if compare and stored!=value: raise RuntimeError('Existing secret differs; explicit coordinated rotation required')
            version=cloud('secrets','versions','describe','latest','--secret='+name,'--format=value(name)').split('/')[-1]
        else:
            cloud('secrets','create',name,'--replication-policy=automatic')
            version=cloud('secrets','versions','add',name,'--data-file=-','--format=value(name)',stdin=value).split('/')[-1]
            stored=value
        cloud('secrets','add-iam-policy-binding',name,'--member=serviceAccount:'+account,'--role=roles/secretmanager.secretAccessor')
        return stored,version
    password,dbversion=secret('ecommerce-db-password',secrets.token_urlsafe(32))
    _,webhookversion=secret('ecommerce-payment-webhook',webhook,True)
    if not any(x['name']==user for x in listed('sql','users','list','--instance='+instance)):
        # gcloud requires this argument. Output is captured; no shell tracing or credential file.
        cloud('sql','users','create',user,'--instance='+instance,'--password='+password)
    cloud('projects','add-iam-policy-binding',PROJECT,'--member=serviceAccount:'+account,'--role=roles/cloudsql.client')
    connection=cloud('sql','instances','describe',instance,'--format=value(connectionName)')
    revision=run(['git','-C',str(ROOT),'rev-parse','--short=12','HEAD'])
    image=args.region+'-docker.pkg.dev/'+PROJECT+'/'+repository+'/api:'+revision
    run(['gcloud','auth','configure-docker',args.region+'-docker.pkg.dev','--quiet'])
    run(['docker','build','-t',image,str(ROOT/'apps/api')]);run(['docker','push',image])
    digest=cloud('artifacts','docker','images','describe',image,'--format=value(image_summary.digest)')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',digest): raise RuntimeError('Unable to resolve immutable image digest')
    image=image.rsplit(':',1)[0]+'@'+digest
    env={'NODE_ENV':'production','HOST':'0.0.0.0','DB_HOST':'/cloudsql/'+connection,'DB_PORT':'5432','DB_NAME':database,'DB_USER':user,'ORDER_STORAGE':'postgres','AUTH_ENABLED':'true','OIDC_ISSUER':issuer,'OIDC_AUDIENCE':audience,'PAYMENT_PROVIDER_BASE_URL':provider,'DOCS_ENABLED':'false'}
    bindings=['DB_PASSWORD=ecommerce-db-password:'+dbversion,'PAYMENT_WEBHOOK_SECRET=ecommerce-payment-webhook:'+webhookversion]
    if urlparse(redis).password:
        _,rv=secret('ecommerce-redis-url',redis,True);bindings.append('REDIS_URL=ecommerce-redis-url:'+rv)
    else: env['REDIS_URL']=redis
    network=[]
    if os.environ.get('GCP_VPC_CONNECTOR'): network=['--vpc-connector='+os.environ['GCP_VPC_CONNECTOR'],'--vpc-egress=private-ranges-only']
    # JSON is YAML-compatible and safely preserves URLs. Contains public configuration only.
    with tempfile.TemporaryDirectory(prefix='ecommerce-deploy-') as directory:
        path=Path(directory)/'env.json';path.write_text(json.dumps(env));path.chmod(0o600)
        common=['--region='+args.region,'--image='+image,'--service-account='+account,'--env-vars-file='+str(path),'--set-secrets='+','.join(bindings)]
        job='ecommerce-migrate';jobs=listed('run','jobs','list','--region='+args.region)
        action='update' if any(x['metadata']['name']==job for x in jobs) else 'create'
        cloud('run','jobs',action,job,*common,'--set-cloudsql-instances='+connection,'--command=node','--args=dist/database/migrate.js','--max-retries=0','--tasks=1','--task-timeout=300s',*network)
        cloud('run','jobs','execute',job,'--region='+args.region,'--wait')
        cloud('run','deploy',service,*common,'--add-cloudsql-instances='+connection,'--port=8080','--min-instances=0','--max-instances=2','--concurrency=20','--memory=512Mi','--cpu=1','--no-allow-unauthenticated','--startup-probe=httpGet.path=/health,httpGet.port=8080,periodSeconds=10,failureThreshold=12',*network)
    print('Cloud deployment command completed; capture service revision, permitted health/readiness and logs before certifying it.')
    print(cloud('run','services','describe',service,'--region='+args.region,'--format=value(status.latestReadyRevisionName,status.url)'))

if __name__=='__main__':
    try: main()
    except (RuntimeError,FileNotFoundError) as error: raise SystemExit(str(error))
