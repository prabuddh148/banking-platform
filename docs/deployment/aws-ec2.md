# Deploy on AWS (one EC2 server, Free plan credits)

This guide puts the whole platform (6 services, Kafka, PostgreSQL, Redis, MailHog and the React
frontend) on **one EC2 server** with Docker Compose. It is the cheapest way to show the project
running on the internet. It is a demo setup, not a production bank.

```
Internet ──► EC2 :80 ──► nginx (React app)
                          └── /api/* ──► api-gateway ──► 5 services ──► Postgres, Kafka, Redis
                                                       (all inside one Docker network)
```

Only port 80 (and 22 for SSH) is open. Postgres, Kafka, the services and MailHog are not reachable
from the internet.

Files used:

| File | What it is |
|---|---|
| `docker/docker-compose.prod.yml` | Small stack: Kafka in KRaft mode, no Grafana/Prometheus/Kafka UI, small JVM settings, only nginx published |
| `frontend/Dockerfile`, `frontend/nginx.conf` | Builds the React app and serves it with nginx; nginx forwards `/api/` to the gateway |
| `infrastructure/aws/setup-ec2.sh` | Installs Docker, adds swap, creates secrets, builds and starts everything |
| `docker/.env.prod.example` | Template of the secrets file (the script creates the real `docker/.env.prod`) |

---

## 1. Cost: what is free and what isn't

- **New AWS accounts (opened after 15 July 2025):** you get $100 in credits at sign-up and can earn
  up to $100 more by doing some getting-started activities, so up to $200. On the **Free plan**,
  usage is taken from the credits, not charged to your card. The account stays on the Free plan for
  6 months or until the credits run out, whichever comes first.
- **Older accounts** stay on the legacy Free Tier (750 hours a month of a micro instance for 12 months).
- If you have had an AWS account before, you usually don't get the new credits.

The stack needs about **3.5 GB of RAM**. A free-tier micro instance has 1 GB, which is not enough.
This guide uses **t3.medium (2 vCPU, 4 GB)**. It is billed per hour, so it uses up credits.
Check the current hourly price on the
[EC2 On-Demand pricing page](https://aws.amazon.com/ec2/pricing/on-demand/) for your region.
Also count the public IPv4 address and the 30 GB disk. To make the credits last:

- **Stop the instance** when you're not showing it. A stopped instance costs nothing per hour;
  you still pay a little for the disk.
- Delete everything when you're done (section 10).
- Don't use MSK (managed Kafka), RDS, EKS or a NAT gateway for this project. They cost much more
  than one EC2 server.

Official pages: [AWS Free Tier](https://aws.amazon.com/free/) ·
[Free Tier FAQs](https://aws.amazon.com/free/faqs/).

---

## 2. Create the account and a budget alert (do this first)

1. Sign up at <https://aws.amazon.com/> and choose the **Free plan**.
2. Turn on MFA for the root user (IAM → Security recommendations).
3. Create a budget alert so you get an email before money is spent:
   **Billing and Cost Management → Budgets → Create budget → Use a template →
   "Zero spend budget"** (or a monthly cost budget of e.g. $5), with your email.
4. Pick a region close to you, e.g. **Asia Pacific (Mumbai) `ap-south-1`**, top right of the console.
   Use the same region for every step.

---

## 3. Create a key pair (for SSH)

EC2 → **Key pairs** → **Create key pair**

- Name: `banking-key`
- Type: ED25519, format: `.pem`
- Download it, e.g. to `C:\Users\<you>\.ssh\banking-key.pem`.

On Windows, make the file readable only by you. OpenSSH refuses keys that other users can read.
Run in PowerShell:

```powershell
icacls $env:USERPROFILE\.ssh\banking-key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

---

## 4. Launch the server

EC2 → **Instances** → **Launch instances**

| Setting | Value |
|---|---|
| Name | `banking-platform` |
| AMI | **Ubuntu Server 24.04 LTS** (64-bit x86) |
| Instance type | **t3.medium** |
| Key pair | `banking-key` |
| Network settings → Firewall | Create security group `banking-sg` with:<br>• **SSH (22)** from **My IP**<br>• **HTTP (80)** from **My IP**, see the note below |
| Storage | **30 GiB gp3** (Docker images and Maven builds need space) |

Click **Launch instance**, open it and copy its **Public IPv4 address** (e.g. `13.234.10.20`).

> **Why HTTP only from "My IP"?** The demo users (`admin` / `admin123` etc.) are public in this
> repo. If port 80 is open to everyone, anyone can log in as admin. Keep it limited to your IP.
> To show it to someone, add their IP to `banking-sg` for a while.

---

## 5. Connect with SSH

```powershell
ssh -i $env:USERPROFILE\.ssh\banking-key.pem ubuntu@<PUBLIC-IP>
```

Type `yes` the first time. You are now on the server (`ubuntu@ip-...:~$`).

---

## 6. Install and start the platform

On the server:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/prabuddh148/banking-platform.git
cd banking-platform
bash infrastructure/aws/setup-ec2.sh
```

The script will:

1. add a 2 GB swap file;
2. install Docker Engine with the compose and buildx plugins;
3. create `docker/.env.prod` with a random Postgres password and JWT secret, and your public IP
   as `PUBLIC_URL`. The file is git-ignored and readable only by you;
4. build the images **one by one**. Each Java service is compiled with Maven inside Docker. The
   first run takes about **15–25 minutes** on a t3.medium; later runs reuse the Maven cache;
5. start everything and wait until the gateway is healthy, then try a demo login.

At the end it prints `Done! Open http://<PUBLIC-IP> ...`.

---

## 7. Use it

- Open `http://<PUBLIC-IP>` in your browser and log in with `rahul` / `password` (customer) or
  `admin` / `admin123` (admin).
- The API works on the same address, for example:

  ```bash
  curl -s -X POST http://<PUBLIC-IP>/api/v1/auth/login \
    -H "Content-Type: application/json" -d '{"username":"rahul","password":"password"}'
  ```

- **See the emails (MailHog).** MailHog listens only on the server itself. Open an SSH tunnel from
  your PC, then browse to <http://localhost:8025>:

  ```powershell
  ssh -i $env:USERPROFILE\.ssh\banking-key.pem -L 8025:localhost:8025 ubuntu@<PUBLIC-IP>
  ```

---

## 8. Everyday commands (on the server, in `~/banking-platform`)

```bash
C="sudo docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod"

$C ps                          # status of every container
$C logs -f --tail=100 transaction-service   # follow one service's logs
sudo docker stats --no-stream  # RAM/CPU per container
$C restart fraud-service       # restart one service
$C down                        # stop everything (data is kept in volumes)
$C up -d                       # start again

# Deploy new code after you push to GitHub
git pull && bash infrastructure/aws/setup-ec2.sh

# Open a SQL shell
sudo docker exec -it banking-postgres psql -U banking -d transactions_db
```

---

## 9. Stopping and starting the server

- **EC2 → Instances → Instance state → Stop.** The hourly charge stops; the disk is kept. The
  containers have `restart: unless-stopped`, so they come back when you **Start** the instance.
- After a stop/start AWS gives the instance a **new public IP**. Update `PUBLIC_URL` in
  `docker/.env.prod` and run `$C up -d`. The site works either way, because nginx serves the app
  and the API on the same address.
- If you need a fixed IP, use an Elastic IP. AWS charges for public IPv4 addresses, so release it
  when you're done.

---

## 10. Delete everything (to stop all costs)

1. EC2 → Instances → select `banking-platform` → **Terminate**. This also deletes the disk if
   "Delete on termination" is on, which is the default for the root volume.
2. EC2 → Elastic IPs → release any you allocated.
3. EC2 → Security groups → delete `banking-sg`. Key pairs → delete `banking-key`.
4. Check **Billing → Bills** the next day to confirm nothing is running.

---

## 11. Troubleshooting

| Problem | What to do |
|---|---|
| `ssh: Connection timed out` | Your IP changed. Edit `banking-sg` and set SSH (and HTTP) to "My IP" again. |
| `UNPROTECTED PRIVATE KEY FILE` | Run the `icacls` command from section 3. |
| Browser can't open `http://<IP>` | Port 80 isn't allowed from your IP in `banking-sg`, or the `web` container isn't up (`$C ps`). Use `http://`, not `https://`. |
| A service keeps restarting / `exited (137)` | Out of memory. Run `sudo docker stats`. Make sure the instance has 4 GB, the swap is on (`swapon --show`), or move to t3.large. |
| Build fails with `no space left on device` | The disk is too small. Increase it to 30 GB, or run `sudo docker builder prune -af`. |
| Login works but transfers stay `PENDING` | Kafka or fraud-service isn't healthy: check `$C logs kafka fraud-service`. |
| 503 `SERVICE_UNAVAILABLE` | A service is still starting (first boot takes a few minutes) or crashed: `$C ps`, then its logs. |
| You want to start fresh (deletes all data) | `$C down -v && bash infrastructure/aws/setup-ec2.sh` |

---

## 12. Possible next steps

- **HTTPS:** point a domain at the server and put [Caddy](https://caddyserver.com/) in front of
  nginx for automatic Let's Encrypt certificates.
- **Real users:** replace the demo users in the gateway config before opening the site to everyone.
- **Automatic deploys:** a GitHub Actions workflow that SSHes in and runs
  `git pull && bash infrastructure/aws/setup-ec2.sh` (see [ci-cd-pipeline.md](ci-cd-pipeline.md)).
- **Backups:** `pg_dumpall` from the Postgres container to S3 with a cron job.
