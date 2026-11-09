# Explicit diagnostic RunTask with API networking/credentials; never an HTTP service.
resource "aws_ecs_task_definition" "verification" {
  count                    = var.release_tag == "" ? 0 : 1
  family                   = "ecommerce-dev-verification"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution["api"].arn
  task_role_arn            = aws_iam_role.task["api"].arn
  container_definitions = jsonencode([{
    name        = "api", image = "${aws_ecr_repository.application["api"].repository_url}:${var.release_tag}", essential = true,
    environment = [for name, value in local.db_env : { name = name, value = value }],
    secrets     = [{ name = "DB_PASSWORD", valueFrom = aws_secretsmanager_secret.application["db-password"].arn }, { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn }],
    command = ["node", "--input-type=module", "-e", <<-JS
      import assert from 'node:assert/strict';
      import {randomUUID} from 'node:crypto';
      import {createClient} from 'redis';
      import {loadDatabaseConfig,loadRedisConfig} from './dist/config/env.js';
      import {createPool} from './dist/database/pool.js';
      const pool=createPool(loadDatabaseConfig());
      const redis=createClient({url:loadRedisConfig().url,socket:{connectTimeout:5000,reconnectStrategy:false}});
      redis.on('error',()=>{});
      const key='aws-verification:'+randomUUID();
      try {
        assert.equal((await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl,true);
        assert.equal((await pool.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS allowed")).rows[0].allowed,false);
        const product=(await pool.query('SELECT name,price_in_minor_units FROM products WHERE sku=$1',['CLASSIC-EVERYDAY-TOTE'])).rows[0];
        assert.equal((await pool.query("SELECT has_table_privilege(current_user,'public.schema_migrations','UPDATE') AS allowed")).rows[0].allowed,false);
        assert.equal(product.name,'Classic Everyday Tote');assert.equal(Number(product.price_in_minor_units),79900);
        await redis.connect();assert.equal(await redis.ping(),'PONG');assert.equal(await redis.get(key),null);
        await redis.set(key,'value',{EX:60});assert.equal(await redis.get(key),'value');assert.ok(await redis.ttl(key)>0);
        await redis.del(key);assert.equal(await redis.incr(key),1);await redis.expire(key,60);
        assert.equal(await redis.eval("local n=redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],ARGV[1]); return n",{keys:[key],arguments:['60']}),2);
        console.log({operation:'aws-verification',databaseTLS:true,runtimeCannotCreateSchema:true,seed:true,valkeyTLSCommands:true,outcome:'PASS'});
      } catch(e) {console.error({operation:'aws-verification',outcome:'FAIL',name:e.name,code:e.code});process.exitCode=1;}
      finally {if(redis.isReady){await redis.del(key);await redis.quit();}else redis.destroy();await pool.end();}
    JS
    ],
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-region" = "ap-south-1", "awslogs-group" = aws_cloudwatch_log_group.task["api"].name, "awslogs-stream-prefix" = "verification" } }
  }])
}
