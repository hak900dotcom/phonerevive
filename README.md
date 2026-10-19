# PhoneRevive (Week Build: Features 1 to 3)

Online shop for used iPhones and replacement parts.

This build has the first three features from my user stories:

1. Search and filters (phones and parts)
2. Product pages (phone detail and part detail)
3. Shopping cart (add, change quantity, remove, totals, 15-minute hold on phones)

## How to run it in VS Code

1. Install Node.js (version 18 or newer) from https://nodejs.org if you do not have it.
2. In VS Code, choose File > Open Folder and open the `phonerevive` folder.
3. Open a terminal (Terminal > New Terminal) and type:

   ```
   node server.js
   ```

4. Open http://localhost:3000 in your browser.
5. To stop it, click in the terminal and press Ctrl+C.

There are no packages to install. The app only uses what comes with Node.js. (`npm start` also works.)

To put the app online so others can open it, see [DEPLOY.md](DEPLOY.md).

## Data files (in the `data` folder)

| File | What it holds |
|------|---------------|
| phones.csv | Each used phone for sale: model, storage, color, grade, battery health, lock status, IMEI check, price, condition notes, status |
| parts.csv | Replacement parts: SKU, name, type, price, stock, and the models each part fits (separated by `\|`) |
| settings.csv | Shipping fee, free shipping amount, tax rate, and how long a phone is held in a cart |
| cart_items.csv | Shopping carts. The app writes to this file when items are added, changed, or removed |

You can open any of these in Excel to add or change products. Restart the server after editing phones.csv, parts.csv, or settings.csv.

## Things to try

- Search "iPhone 13", then filter by Grade A or Unlocked, and sort by price.
- Switch to Parts and search "12 battery", or filter Fits: iPhone 12 Pro.
- Open a phone, add it to the cart, and see the hold timer in the cart.
- Add a part and use the + and – buttons. You cannot go past the stock count.
- Open the site in a second browser (or a private window). A phone in the first cart will not show up for the second shopper.

## Files

- `package.json` - tells Node and Render how to start the app
- `server.js` - the whole app (reads the CSV files, handles pages and the cart)
- `public/style.css` - page styles (mobile first)
- `data/` - the CSV data files
