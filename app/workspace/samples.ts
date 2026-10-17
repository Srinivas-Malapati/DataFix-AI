/** Synthetic demo datasets. Each exercises a different class of data-quality problem. */
export const SAMPLE_DATASETS = [
  {
    id: "sales",
    name: "sales_messy.csv",
    label: "Sales",
    detail: "Duplicates · currency · casing",
    goal: "Standardize product names, normalize currency values, remove exact duplicates, and flag missing payment statuses.",
    csv: `order_id,customer,product,amount,status
1001, Ada Lovelace ,pro plan,"$1,200.00",paid
1002,grace hopper,Starter,"$49.00",PAID
1002,grace hopper,Starter,"$49.00",PAID
1003,Linus Torvalds,PRO PLAN,1200,
1004,Margaret Hamilton, starter ,"$49",Paid`,
  },
  {
    id: "customers",
    name: "customers_messy.csv",
    label: "Customers",
    detail: "Whitespace · emails · missing fields",
    goal: "Trim safe text fields, normalize email casing, preserve customer IDs, and flag missing contact information for review.",
    csv: `customer_id,full_name,email,city,segment
C-001,  Katherine Johnson ,KJ@EXAMPLE.COM,houston,Enterprise
C-002,alan turing,alan@example.com, Manchester ,enterprise
C-003,Grace Hopper,,New York,SMB
C-004, Tim Berners-Lee ,tim@example.com,london,smb
C-005,Barbara Liskov,barbara@example.com,,Enterprise`,
  },
  {
    id: "transactions",
    name: "transactions_messy.csv",
    label: "Transactions",
    detail: "Dates · refunds · ambiguity",
    goal: "Normalize unambiguous dates and payment methods, preserve legitimate negative refunds, and flag ambiguous dates instead of guessing.",
    csv: `transaction_id,date,amount,payment_method,note
T-1001,2026-10-01,249.99,CARD,subscription
T-1002,10/02/2026,-49.00,card,refund
T-1003,03/04/2026,89.50,ACH,ambiguous date
T-1004,2026/10/05,120.00, ach ,renewal
T-1005,,35.25,Cash,date missing`,
  },
] as const;

export type SampleDataset = (typeof SAMPLE_DATASETS)[number];

export const DEFAULT_GOAL =
  "Clean this dataset, standardize inconsistent formats, remove exact duplicates, and flag anything ambiguous for review.";
