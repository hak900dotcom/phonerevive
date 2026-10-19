# Putting PhoneRevive online (free)

You will use two free websites: **GitHub** to hold the code and **Render** to run it. When you finish, you get a link like `https://phonerevive.onrender.com` that anyone can open.

## Part 1: Put the code on GitHub

1. Sign in at github.com.
2. Click the **+** at the top right and choose **New repository**.
3. Name it `phonerevive`, leave it **Public**, and click **Create repository**.
4. On the next page, click the link that says **uploading an existing file**.
5. Unzip `PhoneRevive_WeekBuild.zip` on your computer. Open the `phonerevive` folder, select everything inside it (`server.js`, `package.json`, `README.md`, `DEPLOY.md`, and the `data` and `public` folders), and drag it all onto the GitHub page.
6. Wait for the files to finish uploading, then click **Commit changes**.

Check that `server.js` and `package.json` show up on the main page of the repository, not inside another folder.

## Part 2: Run it on Render

1. Go to render.com and click **Get Started**. Sign up with your GitHub account. This makes it easy to connect the two.
2. Click **New +** and choose **Web Service**.
3. Pick your `phonerevive` repository from the list. If you don't see it, click **Configure account** and give Render access to it.
4. Fill in the form:
   - **Name:** phonerevive (this becomes part of your link)
   - **Language:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Click **Deploy Web Service**.
6. Wait a minute or two until the log says `PhoneRevive is running`. Your link is at the top of the page, under the name.

Send that link to your classmate.

## Good to know

- **The first visit can be slow.** On the free plan, the site goes to sleep after about 15 minutes with no visitors. When someone opens it again, it takes about 30 to 60 seconds to wake up.
- **Carts reset.** When the site sleeps or restarts, `cart_items.csv` goes back to empty. The phones and parts stay because they come from the CSV files in GitHub.
- **Updating the site.** If you change a file, upload the new version to GitHub (open the repository, click **Add file > Upload files**). Render sees the change and updates the site by itself.

## If Render gives you trouble: Replit

1. Sign in at replit.com and click **Create App** (or **+ Create**).
2. Choose **Import from GitHub** and paste your repository link.
3. Click **Run**. Replit shows the site in a preview window.
4. To share it, click **Deploy** and follow the steps for a public link.
