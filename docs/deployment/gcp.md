# Deploy on Google Cloud (one Compute Engine VM, free trial credits)

Same idea as the [AWS guide](aws-ec2.md): the whole platform runs on **one VM** with
`docker/docker-compose.prod.yml`. nginx serves the React app on port 80 and forwards `/api` to the
gateway. Everything is done from the command line with `infrastructure/gcp/gcp.sh`.

```
your PC ──gcloud──► creates firewall rules + VM (e2-medium, Ubuntu 24.04)
                     └── startup.sh (first boot): git clone → setup-ec2.sh → docker compose up
browser ──► http://<VM-IP>  (only your IP is allowed)
```

| File | What it does |
|---|---|
| `infrastructure/gcp/gcp.sh` | Run on your PC: `up`, `status`, `logs`, `ps`, `update`, `myip`, `stop`, `start`, `ssh`, `down` |
| `infrastructure/gcp/startup.sh` | Runs on the VM at boot; on the first boot it clones the repo and runs the setup |
| `infrastructure/aws/setup-ec2.sh` | The actual installer (Docker, swap, secrets, builds, start). Works on AWS and GCP |
| `docker/docker-compose.prod.yml` | The small stack (see the AWS guide for details) |

---

## 1. Cost

- New Google Cloud customers get **$300 of credit for 90 days**. You are not billed during the
  trial. When the credit is used up or the 90 days end, the trial billing account **closes
  automatically** unless you upgrade it to a paid account. Upgrading is a manual step.
- The always-free **e2-micro** (1 GB) is too small for this stack. We use **e2-medium (4 GB)**,
  which is paid from the trial credit. See [Compute Engine pricing](https://cloud.google.com/compute/vm-instance-pricing)
  for the current rate.
- `gcp.sh stop` when you're not using it: a stopped VM has no CPU/RAM charge (the disk still
  costs a little). `gcp.sh down` deletes everything.

Official: [Google Cloud Free Program](https://cloud.google.com/free) ·
[Free trial docs](https://docs.cloud.google.com/free).

---

## 2. One-time setup (browser)

1. Go to <https://console.cloud.google.com/>, sign in and **activate the free trial**. A card is
   needed for verification; it is not charged during the trial.
2. Create a project (top bar → project picker → **New project**), e.g. `banking-platform-demo`.
   Note its **Project ID**.

## 3. One-time setup (your PC)

```powershell
winget install Google.CloudSDK       # then open a NEW terminal
gcloud auth login                    # opens the browser, pick your Google account
gcloud config set project <PROJECT_ID>
```

> **Alternative:** use **Cloud Shell** (the `>_` icon in the console). It already has `gcloud`
> and you're already logged in. Run `git clone https://github.com/prabuddh148/banking-platform.git`
> there and use the same commands.

---

## 4. Deploy

From the repo root (Git Bash on Windows):

```bash
bash infrastructure/gcp/gcp.sh up
```

It will:

1. enable the Compute Engine API;
2. find your public IP and create firewall rules: `banking-allow-http` (tcp:80) and
   `banking-allow-ssh` (tcp:22, plus Google's IAP range), **only from your IP**, applied to VMs
   tagged `banking-web`;
3. create the VM `banking-platform` (e2-medium, Ubuntu 24.04, 30 GB disk, zone `asia-south1-a`
   = Mumbai). It passes `startup.sh` and the repo URL as metadata;
4. wait until `http://<VM-IP>/api/v1/auth/login` works. The first boot compiles all services, so
   it takes **about 20–30 minutes**.

Then open the printed `http://<VM-IP>` and log in with `rahul` / `password` or `admin` / `admin123`.

Change settings with env vars, e.g. `GCP_ZONE=us-central1-a GCP_MACHINE=e2-standard-2 bash infrastructure/gcp/gcp.sh up`.

> The VM clones the code **from GitHub**, so push your changes before `up` or `update`.

---

## 5. Daily use

```bash
bash infrastructure/gcp/gcp.sh status   # VM state, IP, site up?
bash infrastructure/gcp/gcp.sh logs     # first-boot setup log (/var/log/banking-setup.log)
bash infrastructure/gcp/gcp.sh ps       # docker compose ps on the VM
bash infrastructure/gcp/gcp.sh update   # git pull + rebuild + restart on the VM
bash infrastructure/gcp/gcp.sh myip     # your IP changed? allow the new one
bash infrastructure/gcp/gcp.sh ssh      # shell on the VM
bash infrastructure/gcp/gcp.sh stop     # save credits
bash infrastructure/gcp/gcp.sh start    # start again (gets a NEW IP; also re-allows your IP)
bash infrastructure/gcp/gcp.sh down     # delete VM + disk + firewall rules
```

On the VM the app lives in `/opt/banking-platform`. The commands from the AWS guide, section 8,
work there too, with `sudo`.

**Emails (MailHog):** `gcloud compute ssh banking-platform --zone asia-south1-a -- -L 8025:localhost:8025`
then open <http://localhost:8025>.

---

## 6. Troubleshooting

| Problem | What to do |
|---|---|
| `gcp.sh up` says the API or billing isn't enabled | Activate the free trial and link the project to the trial billing account (Billing → My projects). |
| `Quota 'CPUS' exceeded` or zone has no capacity | Use another zone: `GCP_ZONE=asia-south1-b` or `us-central1-a`. |
| Site never comes up | `gcp.sh logs`. If the log is empty, run `gcloud compute instances get-serial-port-output banking-platform --zone asia-south1-a`. |
| Browser times out | Your IP changed: `gcp.sh myip`. Use `http://`, not `https://`. |
| `gcloud compute ssh` asks to create a key / PuTTY window | Normal on the first run on Windows; accept it. |
| Containers restarting with exit 137 | Out of memory. Use `GCP_MACHINE=e2-standard-2` (8 GB). |
