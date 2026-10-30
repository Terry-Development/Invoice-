// ============================================================
// RECEIPT → AUTOCOUNT
// GOOGLE APPS SCRIPT BACKEND
// ============================================================


// ============================================================
// GOOGLE SHEET
// ============================================================

const SHEET_NAME = "Sheet1";
const INVOICE_SHEET_NAME = "Invoice Register";


// ============================================================
// GEMINI MODELS
// ============================================================

const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash"
];


// ============================================================
// FINAL RETRY SETTINGS
// ============================================================

const RETRY_AFTER_ALL_MODELS = true;

const FINAL_RETRY_DELAY = 1200;


// ============================================================
// GET
// ============================================================

function doGet() {

  return jsonResponse({

    success: true,

    message:
      "Receipt → AutoCount API is running."

  });

}


// ============================================================
// POST
// ============================================================

function doPost(e) {

  try {

    if (
      !e ||
      !e.postData ||
      !e.postData.contents
    ) {

      throw new Error(
        "No POST data received."
      );

    }


    const data =
      JSON.parse(
        e.postData.contents
      );


    if (
      !data.action
    ) {

      throw new Error(
        "Missing action."
      );

    }


    // --------------------------------------------------------
    // EXTRACTION
    // --------------------------------------------------------

    if (
      data.action === "extract"
    ) {

      return jsonResponse(
        handleGeminiExtraction(data)
      );

    }


    // --------------------------------------------------------
    // SAVE
    // --------------------------------------------------------

    if (
      data.action === "save"
    ) {

      return jsonResponse(
        handleSaveToSheet(data)
      );

    }


    // Invoice statement actions are intentionally separate from
    // the existing receipt "extract" and "save" actions.
    if (data.action === "extractInvoices") {
      return jsonResponse(handleInvoiceStatementExtraction(data));
    }
    if (data.action === "saveInvoices") {
      return jsonResponse(handleSaveInvoiceRegister(data));
    }

    throw new Error(
      "Unknown action: " +
      data.action
    );


  } catch (error) {

    console.error(
      error
    );


    return jsonResponse({

      success: false,

      error:
        error.message ||
        String(error)

    });

  }

}


// ============================================================
// GEMINI EXTRACTION
// ============================================================

function handleGeminiExtraction(data) {

  if (
    !Array.isArray(data.images) ||
    data.images.length === 0
  ) {

    throw new Error(
      "No images received."
    );

  }


  const apiKey =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        "GEMINI_API_KEY"
      );


  if (!apiKey) {

    throw new Error(
      "GEMINI_API_KEY is not configured."
    );

  }


  const images =
    data.images;


  const prompt =
    buildExtractionPrompt(
      images.length
    );


  // ==========================================================
  // BUILD GEMINI PARTS
  // ==========================================================

  const parts = [

    {
      text: prompt
    }

  ];


  images.forEach(
    function(image) {

      parts.push({

        inlineData: {

          mimeType:
            image.mimeType ||
            "image/jpeg",

          data:
            image.base64

        }

      });

    }
  );


  let lastError = null;


  // ==========================================================
  // FIRST MODEL PASS
  // ==========================================================

  for (
    let i = 0;
    i < GEMINI_MODELS.length;
    i++
  ) {

    const model =
      GEMINI_MODELS[i];


    try {

      const result =
        callGeminiModel(
          model,
          apiKey,
          parts,
          images.length
        );


      // ------------------------------------------------------
      // Add filename to each result
      // ------------------------------------------------------

      result.forEach(
        function(item, index) {

          item.fileName =
            images[index].originalName ||
            "";

        }
      );


      return result;


    } catch (error) {

      lastError =
        error;

      console.log(
        "Gemini model failed: " +
        model +
        " | " +
        error.message
      );

    }

  }


  // ==========================================================
  // FINAL RETRY AFTER ALL MODELS
  // ==========================================================

  if (
    RETRY_AFTER_ALL_MODELS
  ) {

    Utilities.sleep(
      FINAL_RETRY_DELAY
    );


    for (
      let i = 0;
      i < GEMINI_MODELS.length;
      i++
    ) {

      const model =
        GEMINI_MODELS[i];


      try {

        const result =
          callGeminiModel(
            model,
            apiKey,
            parts,
            images.length
          );


        result.forEach(
          function(item, index) {

            item.fileName =
              images[index].originalName ||
              "";

          }
        );


        return result;


      } catch (error) {

        lastError =
          error;

        console.log(
          "Final Gemini retry failed: " +
          model +
          " | " +
          error.message
        );

      }

    }

  }


  throw new Error(
    "ALL GEMINI MODELS FAILED. Last error: " +
    (
      lastError
        ? lastError.message
        : "Unknown error"
    )
  );

}


// ============================================================
// EXTRACTION PROMPT
// ============================================================

function buildExtractionPrompt(
  imageCount
) {

  return `
You are a receipt and invoice extraction system for Malaysian accounting.

You will receive ${imageCount} receipt/invoice image(s).

Extract information from EACH image separately.

Return EXACTLY ${imageCount} JSON objects in an array.

The order MUST match the image order.

Do not combine different images.


============================================================
FIELDS TO EXTRACT
============================================================

For every image extract:

1. company
2. item
3. date
4. price
5. transactionType
6. autocount
7. invoiceNo
8. invoiceDate
9. amount


============================================================
COMPANY
============================================================

company:

Extract the business/company/supplier name.

Convert to UPPERCASE.

Do not invent a company name.

If unavailable:

"UNKNOWN"


============================================================
ITEM
============================================================

item:

Extract the main goods, service, or transaction shown on the receipt.

Keep it SHORT.

Prefer approximately 1–4 words.

Convert to UPPERCASE.

Examples:

"KITCHEN SINK"

"CEILING CASSETTE COPPER SENSOR"

"LED LIGHT"

"SOCIAL MEDIA SERVICES"

If the item cannot reasonably be identified:

"UNKNOWN"


============================================================
DATE
============================================================

date:

Extract the main transaction/receipt date.

Format:

DD/MM/YYYY

Examples:

07/07/25

24/09/26

If unavailable:

"UNKNOWN"


============================================================
PRICE
============================================================

price:

Extract the final transaction price/total shown on the receipt.

Return numbers only.

Do not include:

RM

$

commas

currency symbols

Examples:

370.31

26.07

990

If unavailable:

"UNKNOWN"


============================================================
TRANSACTION TYPE
============================================================

transactionType:

Evaluate what the transaction actually represents.

Choose the most appropriate type from:

PURCHASE
RENTAL
SERVICE
REPAIR
MAINTENANCE
DELIVERY
TRANSPORT
PROFESSIONAL FEE
SUBSCRIPTION
LICENCE
DEPOSIT
INSTALLATION
CONSULTANCY
TRAINING
ADVERTISEMENT
UTILITY
OTHER


Do NOT automatically classify everything as PURCHASE.

Look at the actual receipt and determine the appropriate transaction type.

If uncertain:

OTHER


============================================================
AUTOCOUNT
============================================================

autocount:

Generate the AutoCount description based on the actual
transaction.

For normal goods:

BEING PURCHASE OF [ITEM] - [COMPANY] - [DATE]

For repair:

BEING REPAIR OF [ITEM] - [COMPANY] - [DATE]

For maintenance:

BEING MAINTENANCE OF [ITEM] - [COMPANY] - [DATE]

For delivery:

BEING DELIVERY OF [ITEM] - [COMPANY] - [DATE]

For rental:

BEING RENTAL OF [ITEM] - [COMPANY] - [DATE]

For installation:

BEING INSTALLATION OF [ITEM] - [COMPANY] - [DATE]

For consultancy:

BEING CONSULTANCY SERVICE - [COMPANY] - [DATE]

For professional fee:

BEING PROFESSIONAL FEE - [COMPANY] - [DATE]

For subscription:

BEING SUBSCRIPTION - [COMPANY] - [DATE]

For advertisement:

BEING ADVERTISEMENT SERVICE - [COMPANY] - [DATE]

For utility:

BEING UTILITY - [COMPANY] - [DATE]

Use the most appropriate wording based on the receipt.

Do not invent information.

Convert the AutoCount line to UPPERCASE.


============================================================
INVOICE NUMBER
============================================================

invoiceNo:

Extract the invoice number if one is clearly shown.

Look for labels such as:

Invoice No
Invoice Number
Inv No
Inv #
Bill No
Document No

Return the actual invoice number.

Do not confuse:

invoice number
receipt number
customer number
phone number
tax number

If no invoice number is shown:

"UNKNOWN"


============================================================
INVOICE DATE
============================================================

invoiceDate:

Extract the invoice date.

Look specifically for the date associated with the invoice/document.

Format:

DD.MM.YY

If the invoice date is clearly the same as the transaction/receipt date,
it may use the same date.

If unavailable:

"UNKNOWN"


============================================================
AMOUNT
============================================================

amount:

Extract the FINAL TOTAL / GRAND TOTAL / AMOUNT PAYABLE
for the invoice or receipt.

Return numbers only.

Do not include:

RM

$

currency symbols

commas

Examples:

370.31

25

1250.50

If unavailable:

"UNKNOWN"


============================================================
IMPORTANT
============================================================

Do not guess.

Do not invent invoice numbers.

Do not invent dates.

Do not invent amounts.

Read the image carefully.

If a field is genuinely unavailable, return:

"UNKNOWN"


============================================================
OUTPUT FORMAT
============================================================

Return ONLY valid JSON.

Do not use Markdown.

Do not use code fences.

Return exactly this structure:

[
  {
    "company": "COMPANY NAME",
    "item": "ITEM",
    "date": "DD.MM.YY",
    "price": "123.45",
    "transactionType": "PURCHASE",
    "autocount": "BEING PURCHASE OF ITEM - COMPANY - DD.MM.YY",
    "invoiceNo": "INV12345",
    "invoiceDate": "DD.MM.YY",
    "amount": "123.45"
  }
]

Return exactly ${imageCount} objects.
`;
}


// ============================================================
// CALL GEMINI MODEL
// ============================================================

function callGeminiModel(
  model,
  apiKey,
  parts,
  expectedCount
) {

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);


  const payload = {

    contents: [

      {

        role: "user",

        parts: parts

      }

    ],

    generationConfig: {

      temperature: 0,

      responseMimeType:
        "application/json"

    }

  };


  const response =
    UrlFetchApp.fetch(
      endpoint,
      {

        method: "post",

        contentType:
          "application/json",

        payload:
          JSON.stringify(payload),

        muteHttpExceptions:
          true

      }
    );


  const status =
    response.getResponseCode();


  const text =
    response.getContentText();


  if (
    status < 200 ||
    status >= 300
  ) {

    throw new Error(
      "GEMINI HTTP " +
      status +
      ": " +
      extractGeminiErrorMessage(text)
    );

  }


  let data;


  try {

    data =
      JSON.parse(text);

  } catch (error) {

    throw new Error(
      "Gemini returned invalid JSON response."
    );

  }


  if (
    !data.candidates ||
    !data.candidates.length
  ) {

    throw new Error(
      "Gemini returned no candidates."
    );

  }


  const candidate =
    data.candidates[0];


  if (
    !candidate.content ||
    !candidate.content.parts
  ) {

    throw new Error(
      "Gemini returned no content."
    );

  }


  let jsonText = "";


  candidate.content.parts.forEach(
    function(part) {

      if (
        part.text
      ) {

        jsonText +=
          part.text;

      }

    }
  );


  jsonText =
    cleanJsonText(
      jsonText
    );


  let results;


  try {

    results =
      JSON.parse(
        jsonText
      );

  } catch (error) {

    throw new Error(
      "Gemini JSON could not be parsed."
    );

  }


  if (
    !Array.isArray(results)
  ) {

    throw new Error(
      "Gemini did not return an array."
    );

  }


  if (
    results.length !== expectedCount
  ) {

    throw new Error(
      "Expected " +
      expectedCount +
      " results but Gemini returned " +
      results.length +
      "."
    );

  }


  return results.map(
    function(result) {

      return normalizeResult(
        result,
        model
      );

    }
  );

}


// ============================================================
// NORMALIZE RESULT
// ============================================================

function normalizeResult(
  result,
  model
) {

  const company =
    cleanUppercase(
      result.company
    );


  const item =
    cleanUppercase(
      result.item
    );


  const date =
    cleanDate(
      result.date
    );


  const price =
    cleanPrice(
      result.price
    );


  const transactionType =
    cleanTransactionType(
      result.transactionType
    );


  const invoiceNo =
    cleanText(
      result.invoiceNo
    );


  const invoiceDate =
    cleanDate(
      result.invoiceDate
    );


  const amount =
    cleanPrice(
      result.amount
    );


  let autocount =
    cleanUppercase(
      result.autocount
    );


  // ----------------------------------------------------------
  // If Gemini did not provide an AutoCount line,
  // build one automatically.
  // ----------------------------------------------------------

  if (
    !autocount ||
    autocount === "UNKNOWN"
  ) {

    autocount =
      buildAutoCount(
        transactionType,
        item,
        company,
        date
      );

  }


  return {

    success: true,

    company:
      company || "UNKNOWN",

    item:
      item || "UNKNOWN",

    date:
      date || "UNKNOWN",

    price:
      price || "UNKNOWN",

    transactionType:
      transactionType || "OTHER",

    autocount:
      autocount || "UNKNOWN",

    invoiceNo:
      invoiceNo || "UNKNOWN",

    invoiceDate:
      invoiceDate || "UNKNOWN",

    amount:
      amount || "UNKNOWN",

    modelUsed:
      model

  };

}


// ============================================================
// CLEAN TEXT
// ============================================================

function cleanText(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }


  const text =
    String(value)
      .trim();


  if (
    !text
  ) {

    return "";

  }


  if (
    text.toUpperCase() === "UNKNOWN"
  ) {

    return "";

  }


  return text;

}


// ============================================================
// UPPERCASE
// ============================================================

function cleanUppercase(value) {

  const text =
    cleanText(
      value
    );


  if (!text) {

    return "";

  }


  return text
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .toUpperCase();

}


// ============================================================
// DATE
// ============================================================

function cleanDate(value) {

  if (!value) return "UNKNOWN";

  let s = String(value).trim();

  // Convert separators to /
  s = s.replace(/[.-]/g, "/");

  const parts = s.split("/");

  if (parts.length !== 3) {
    return s;
  }

  let day = parts[0].padStart(2, "0");
  let month = parts[1].padStart(2, "0");
  let year = parts[2];

  // Convert YY to YYYY
  if (year.length === 2) {
    year = "20" + year;
  }

  return `${day}/${month}/${year}`;
}


// ============================================================
// PRICE / AMOUNT
// ============================================================

function cleanPrice(value) {

  const text =
    cleanText(
      value
    );


  if (!text) {

    return "";

  }


  const cleaned =
    text.replace(
      /,/g,
      ""
    );


  const match =
    cleaned.match(
      /-?\d+(?:\.\d{1,2})?/
    );


  if (!match) {

    return "";

  }


  return match[0];

}


// ============================================================
// TRANSACTION TYPE
// ============================================================

function cleanTransactionType(
  value
) {

  const text =
    cleanUppercase(
      value
    );


  const allowed = [

    "PURCHASE",
    "RENTAL",
    "SERVICE",
    "REPAIR",
    "MAINTENANCE",
    "DELIVERY",
    "TRANSPORT",
    "PROFESSIONAL FEE",
    "SUBSCRIPTION",
    "LICENCE",
    "DEPOSIT",
    "INSTALLATION",
    "CONSULTANCY",
    "TRAINING",
    "ADVERTISEMENT",
    "UTILITY",
    "OTHER"

  ];


  if (
    allowed.indexOf(
      text
    ) !== -1
  ) {

    return text;

  }


  return "OTHER";

}


// ============================================================
// BUILD AUTOCOUNT
// ============================================================

function buildAutoCount(
  transactionType,
  item,
  company,
  date
) {

  const type =
    transactionType ||
    "OTHER";


  const safeItem =
    item ||
    "UNKNOWN";


  const safeCompany =
    company ||
    "UNKNOWN";


  const safeDate =
    date ||
    "UNKNOWN";


  switch (type) {

    case "PROFESSIONAL FEE":

      return (
        "BEING PROFESSIONAL FEE - " +
        safeCompany +
        " - " +
        safeDate
      );


    case "SUBSCRIPTION":

      return (
        "BEING SUBSCRIPTION - " +
        safeCompany +
        " - " +
        safeDate
      );


    case "UTILITY":

      return (
        "BEING UTILITY - " +
        safeCompany +
        " - " +
        safeDate
      );


    case "CONSULTANCY":

      return (
        "BEING CONSULTANCY SERVICE - " +
        safeCompany +
        " - " +
        safeDate
      );


    case "ADVERTISEMENT":

      return (
        "BEING ADVERTISEMENT SERVICE - " +
        safeCompany +
        " - " +
        safeDate
      );


    default:

      return (
        "BEING " +
        type +
        " OF " +
        safeItem +
        " - " +
        safeCompany +
        " - " +
        safeDate
      );

  }

}


// ============================================================
// CLEAN GEMINI JSON
// ============================================================

function cleanJsonText(
  text
) {

  let cleaned =
    String(text)
      .trim();


  if (
    cleaned.startsWith(
      "```"
    )
  ) {

    cleaned =
      cleaned.replace(
        /^```(?:json)?/i,
        ""
      );


    cleaned =
      cleaned.replace(
        /```$/i,
        ""
      );


    cleaned =
      cleaned.trim();

  }


  return cleaned;

}


// ============================================================
// GEMINI ERROR
// ============================================================

function extractGeminiErrorMessage(
  text
) {

  try {

    const data =
      JSON.parse(
        text
      );


    if (
      data.error &&
      data.error.message
    ) {

      return data.error.message;

    }

  } catch (error) {

    // Ignore JSON parse error.

  }


  return String(text)
    .substring(
      0,
      500
    );

}


// ============================================================
// SAVE TO GOOGLE SHEET
// ============================================================

function handleSaveToSheet(
  data
) {

  if (
    !data ||
    !Array.isArray(data.results) ||
    data.results.length === 0
  ) {

    throw new Error(
      "No results to save."
    );

  }


  const spreadsheet =
    SpreadsheetApp
      .getActiveSpreadsheet();


  let sheet =
    spreadsheet.getSheetByName(
      SHEET_NAME
    );


  if (!sheet) {

    sheet =
      spreadsheet.insertSheet(
        SHEET_NAME
      );

  }


  // ==========================================================
  // GET EXISTING HEADERS
  // ==========================================================

  let lastColumn =
    Math.max(
      sheet.getLastColumn(),
      1
    );


  let headerValues =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getValues()[0];


  // ==========================================================
  // CREATE HEADERS IF SHEET IS EMPTY
  // ==========================================================

  const hasAnyHeader =
    headerValues.some(
      function(header) {

        return String(header)
          .trim() !== "";

      }
    );


  if (!hasAnyHeader) {

    const defaultHeaders = [

      "Company",
      "Item",
      "Date",
      "Price",
      "Invoice No",
      "Invoice Date",
      "Amount",
      "Transaction Type",
      "AutoCount Line",
      "Receipt Filename",
      "Time Added",
      "Model Used"

    ];


    sheet
      .getRange(
        1,
        1,
        1,
        defaultHeaders.length
      )
      .setValues([
        defaultHeaders
      ]);


    lastColumn =
      defaultHeaders.length;


    headerValues =
      defaultHeaders;

  }


  // ==========================================================
  // BUILD HEADER LOOKUP
  // ==========================================================

  const headers = {};


  headerValues.forEach(
    function(header, index) {

      const name =
        String(header)
          .trim()
          .toLowerCase();


      if (
        name !== ""
      ) {

        headers[name] =
          index + 1;

      }

    }
  );


  // ==========================================================
  // FIND COLUMN
  // ==========================================================

  function findColumn(
    names
  ) {

    for (
      let i = 0;
      i < names.length;
      i++
    ) {

      const key =
        names[i]
          .trim()
          .toLowerCase();


      if (
        headers[key]
      ) {

        return headers[key];

      }

    }


    return null;

  }


  // ==========================================================
  // EXISTING + NEW COLUMNS
  // ==========================================================

  const companyColumn =
    findColumn([
      "company",
      "company name"
    ]);


  const itemColumn =
    findColumn([
      "item",
      "description"
    ]);


  const dateColumn =
    findColumn([
      "date",
      "transaction date"
    ]);


  const priceColumn =
    findColumn([
      "price",
      "transaction price"
    ]);


  const invoiceNoColumn =
    findColumn([
      "invoice no",
      "invoice number",
      "inv no",
      "inv number",
      "invoice #",
      "inv #"
    ]);


  const invoiceDateColumn =
    findColumn([
      "invoice date",
      "inv date"
    ]);


  const amountColumn =
    findColumn([
      "amount",
      "invoice amount",
      "total amount",
      "grand total"
    ]);


  const transactionTypeColumn =
    findColumn([
      "transaction type",
      "type"
    ]);


  const autoCountColumn =
    findColumn([
      "autocount line",
      "autocount",
      "auto count line"
    ]);


  const filenameColumn =
    findColumn([
      "receipt filename",
      "filename",
      "file name"
    ]);


  const timeAddedColumn =
    findColumn([
      "time added",
      "timestamp",
      "time"
    ]);


  const modelColumn =
    findColumn([
      "model used",
      "model"
    ]);


  // ==========================================================
  // AUTOCOUNT IS REQUIRED
  // ==========================================================

  if (
    !autoCountColumn
  ) {

    throw new Error(
      'Could not find "AutoCount Line" in row 1.'
    );

  }


  // ==========================================================
  // ADD MISSING NEW COLUMNS AUTOMATICALLY
  // ==========================================================

  function addHeaderIfMissing(
    headerName,
    columnVariable
  ) {

    if (
      columnVariable
    ) {

      return columnVariable;

    }


    const newColumn =
      sheet.getLastColumn() + 1;


    sheet
      .getRange(
        1,
        newColumn
      )
      .setValue(
        headerName
      );


    headers[
      headerName
        .toLowerCase()
    ] =
      newColumn;


    return newColumn;

  }


  const finalInvoiceNoColumn =
    addHeaderIfMissing(
      "Invoice No",
      invoiceNoColumn
    );


  const finalInvoiceDateColumn =
    addHeaderIfMissing(
      "Invoice Date",
      invoiceDateColumn
    );


  const finalAmountColumn =
    addHeaderIfMissing(
      "Amount",
      amountColumn
    );


  // ==========================================================
  // REFRESH LAST COLUMN
  // ==========================================================

  lastColumn =
    sheet.getLastColumn();


  // ==========================================================
  // PREPARE ALL ROWS
  // ==========================================================

  const rows = [];


  data.results.forEach(
    function(result) {

      const row =
        new Array(
          lastColumn
        ).fill("");


      // ------------------------------------------------------
      // COMPANY
      // ------------------------------------------------------

      if (
        companyColumn
      ) {

        row[
          companyColumn - 1
        ] =
          result.company ||
          "UNKNOWN";

      }


      // ------------------------------------------------------
      // ITEM
      // ------------------------------------------------------

      if (
        itemColumn
      ) {

        row[
          itemColumn - 1
        ] =
          result.item ||
          "UNKNOWN";

      }


      // ------------------------------------------------------
      // DATE
      // ------------------------------------------------------

      if (
        dateColumn
      ) {

        row[
          dateColumn - 1
        ] =
          result.date ||
          "UNKNOWN";

      }


      // ------------------------------------------------------
      // PRICE
      // ------------------------------------------------------

      if (
        priceColumn
      ) {

        row[
          priceColumn - 1
        ] =
          result.price ||
          "UNKNOWN";

      }


      // ------------------------------------------------------
      // INVOICE NO
      // ------------------------------------------------------

      row[
        finalInvoiceNoColumn - 1
      ] =
        result.invoiceNo ||
        "UNKNOWN";


      // ------------------------------------------------------
      // INVOICE DATE
      // ------------------------------------------------------

      row[
        finalInvoiceDateColumn - 1
      ] =
        result.invoiceDate ||
        "UNKNOWN";


      // ------------------------------------------------------
      // AMOUNT
      // ------------------------------------------------------

      row[
        finalAmountColumn - 1
      ] =
        result.amount ||
        "UNKNOWN";


      // ------------------------------------------------------
      // TRANSACTION TYPE
      // ------------------------------------------------------

      if (
        transactionTypeColumn
      ) {

        row[
          transactionTypeColumn - 1
        ] =
          result.transactionType ||
          "OTHER";

      }


      // ======================================================
      // AUTOCOUNT LINE
      // ======================================================

      row[
        autoCountColumn - 1
      ] =
        result.autocount ||
        "UNKNOWN";


      // ------------------------------------------------------
      // RECEIPT FILENAME
      // ------------------------------------------------------

      if (
        filenameColumn
      ) {

        row[
          filenameColumn - 1
        ] =
          result.fileName ||
          "";

      }


      // ------------------------------------------------------
      // TIME ADDED
      // ------------------------------------------------------

      if (
        timeAddedColumn
      ) {

        row[
          timeAddedColumn - 1
        ] =
          new Date();

      }


      // ------------------------------------------------------
      // MODEL USED
      // ------------------------------------------------------

      if (
        modelColumn
      ) {

        row[
          modelColumn - 1
        ] =
          result.modelUsed ||
          "";

      }


      rows.push(
        row
      );

    }
  );


  // ==========================================================
  // WRITE ALL ROWS AT ONCE
  // ==========================================================

  if (
    rows.length > 0
  ) {

    sheet
      .getRange(
        sheet.getLastRow() + 1,
        1,
        rows.length,
        lastColumn
      )
      .setValues(
        rows
      );

  }


  // ==========================================================
  // RETURN SUCCESS
  // ==========================================================

  return {

    success: true,

    saved:
      data.results.length,

    message:
      "Saved " +
      data.results.length +
      " receipt(s) to Google Sheet."

  };

}


// ============================================================
// AUTHORIZE / TEST GEMINI
// ============================================================

function authorizeGemini() {

  const apiKey =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        "GEMINI_API_KEY"
      );


  if (!apiKey) {

    throw new Error(
      "GEMINI_API_KEY is not configured."
    );

  }


  GEMINI_MODELS.forEach(
    function(model) {

      const endpoint =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) +
        "?key=" +
        encodeURIComponent(apiKey);


      try {

        const response =
          UrlFetchApp.fetch(
            endpoint,
            {
              method: "get",
              muteHttpExceptions: true
            }
          );


        console.log(
          model +
          " HTTP " +
          response.getResponseCode()
        );


      } catch (error) {

        console.log(
          model +
          " ERROR " +
          error.message
        );

      }

    }
  );

}


// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(
  data
) {

  return ContentService
    .createTextOutput(
      JSON.stringify(data)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );

}

// ============================================================
// INVOICE STATEMENT EXTENSION
// Separate from the existing receipt / AutoCount workflow.
// These functions NEVER write to Sheet1.
// ============================================================

function setupInvoiceRegister() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("Open this Apps Script from its bound Google Spreadsheet.");
  }
  const sheet = getOrCreateInvoiceRegisterSheet_(spreadsheet);
  return {
    success: true,
    sheetName: sheet.getName(),
    message: "Invoice Register is ready. Sheet1 was not modified."
  };
}

/**
 * POST {action: "extractInvoices", images: [{base64, mimeType, originalName}, ...]}
 * One statement image can contain ANY NUMBER of invoice rows.
 * Returns {success, results: [...], skipped: [...], imagesProcessed, invoicesFound}.
 */
function handleInvoiceStatementExtraction(data) {
  if (!data || !Array.isArray(data.images) || !data.images.length) {
    throw new Error("No invoice statement images received.");
  }

  const key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  const images = data.images;
  const parts = [{text: buildInvoiceStatementPrompt_(images.length)}];
  images.forEach(function(image, index) {
    if (!image || !image.base64 || typeof image.base64 !== "string") {
      throw new Error("Image " + (index + 1) + " has no base64 data.");
    }
    parts.push({
      inlineData: {
        mimeType: image.mimeType || "image/jpeg",
        data: image.base64
      }
    });
  });

  let lastError = null;
  const passes = RETRY_AFTER_ALL_MODELS ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    if (pass > 0) Utilities.sleep(FINAL_RETRY_DELAY);
    for (let i = 0; i < GEMINI_MODELS.length; i++) {
      const model = GEMINI_MODELS[i];
      try {
        return callInvoiceStatementModel_(model, key, parts, images);
      } catch (error) {
        lastError = error;
        console.log("Invoice extraction: " + model + " failed: " + error.message);
      }
    }
  }
  throw new Error("Invoice extraction failed on all models. Last error: " +
    (lastError ? lastError.message : "Unknown error"));
}

function buildInvoiceStatementPrompt_(imageCount) {
  return `You are a precise Malaysian accounts-receivable INVOICE REGISTER extractor.
You are receiving ${imageCount} image(s), each of which may be a statement of account
with MANY invoice rows or a single invoice document.

OBJECTIVE: extract ALL genuine invoice entries, one record per invoice row.

For each statement image:
- Identify the table columns, for example Date | Description | Invoice | Payment | Balance.
- INCLUDE rows explicitly identified as an Invoice in the Description column.
- The invoice number is the number belonging to that row, e.g. "Invoice #INV2501-215"
  gives "INV2501-215". Preserve all letters, hyphens and leading zeros exactly.
- The invoice date is the DATE in the SAME invoice row, not the statement date.
- The amount is ONLY the value under the INVOICE column in the SAME row.
- IGNORE amounts from the Payment and Balance columns; Balance is never invoice amount.
- IGNORE Balance Forward, Payment, Receipt, Credit Memo/Credit Note, Debit Balance,
  opening balance, carried forward, totals, footers and running balances.
- Include every invoice row even when multiple invoices have the same date.
- For a standalone invoice document, include one invoice only when its invoice
  number, invoice date and amount payable are clearly provided.
- Do not invent or reconstruct unreadable data. For an unreadable required field,
  return "UNKNOWN" in that field for review instead of guessing.

OUTPUT: Valid JSON ONLY. Top level MUST be a JSON array containing EXACTLY
${imageCount} objects, IN THE INPUT IMAGE ORDER. Each object MUST have an "invoices"
array, with zero or more invoice records. Each record MUST have only these fields:
{"invoiceNo":"INV2501-215", "invoiceDate":"08/01/2025", "amount":"17.70"}

Use DD/MM/YYYY for invoiceDate and plain decimal digits (no RM/comma) for amount.
An image with no invoice rows must be {"invoices":[]}.
Return no commentary or Markdown.`;
}

function callInvoiceStatementModel_(model, key, parts, images) {
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);

  const response = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      contents: [{role: "user", parts: parts}],
      generationConfig: {temperature: 0, responseMimeType: "application/json"}
    }),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error("Gemini HTTP " + status + ": " + extractGeminiErrorMessage(body));
  }

  let apiResult;
  try {
    apiResult = JSON.parse(body);
  } catch (_) {
    throw new Error("Gemini returned an invalid API response.");
  }
  const candidate = apiResult.candidates && apiResult.candidates[0];
  const candidateParts = candidate && candidate.content && candidate.content.parts;
  if (!Array.isArray(candidateParts)) throw new Error("Gemini returned no content parts.");

  const jsonText = cleanJsonText(candidateParts.map(function(part) {
    return part.text || "";
  }).join(""));
  let documents;
  try {
    documents = JSON.parse(jsonText);
  } catch (_) {
    throw new Error("Invoice JSON could not be parsed.");
  }
  if (!Array.isArray(documents) || documents.length !== images.length) {
    throw new Error("Expected one invoice collection per image (" + images.length + ").");
  }

  const valid = [];
  const skipped = [];
  documents.forEach(function(document, imageIndex) {
    if (!document || !Array.isArray(document.invoices)) {
      throw new Error("Image " + (imageIndex + 1) + " is missing its invoices array.");
    }
    document.invoices.forEach(function(row, rowIndex) {
      const invoiceNo = normalizeStatementInvoiceNo_(row && row.invoiceNo);
      const invoiceDate = normalizeStatementDate_(row && row.invoiceDate);
      const amount = normalizeStatementAmount_(row && row.amount);
      const fileName = String(images[imageIndex].originalName || "");

      if (!invoiceNo || !invoiceDate || amount === null) {
        skipped.push({
          imageNumber: imageIndex + 1,
          rowNumber: rowIndex + 1,
          fileName: fileName,
          invoiceNo: row && row.invoiceNo || "UNKNOWN",
          invoiceDate: row && row.invoiceDate || "UNKNOWN",
          amount: row && row.amount || "UNKNOWN",
          reason: "Missing or invalid invoice number/date/amount. Check original image."
        });
        return;
      }
      valid.push({
        invoiceNo: invoiceNo,
        invoiceDate: invoiceDate,
        amount: amount,
        fileName: fileName,
        modelUsed: model
      });
    });
  });

  return {
    success: true,
    results: valid,
    skipped: skipped,
    imagesProcessed: images.length,
    invoicesFound: valid.length,
    message: skipped.length
      ? "Some incomplete invoice entries require manual review before saving."
      : "Invoice extraction finished. Review and save the extracted rows."
  };
}

// Accept DD/MM/YYYY, DD.MM.YY, DD-MM-YYYY or YYYY-MM-DD.
// Validate actual calendar days; never silently guess month/day order.
function normalizeStatementDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "Asia/Kuala_Lumpur", "dd/MM/yyyy");
  }
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  let d, m, y, match;

  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = +match[1]; m = +match[2]; d = +match[3];
  } else if ((match = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/))) {
    d = +match[1]; m = +match[2]; y = +match[3];
    if (match[3].length === 2) y += 2000;
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) {
    return null;
  }
  return String(d).padStart(2, "0") + "/" +
    String(m).padStart(2, "0") + "/" + y;
}

function normalizeStatementInvoiceNo_(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s || /^(UNKNOWN|N\/?A|NONE|NULL)$/i.test(s)) return null;
  s = s.replace(/^invoice\s*(?:number|no\.?|#)?\s*[:#]?\s*/i, "")
       .replace(/^#/, "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._\/#-]{0,79}$/.test(s)) return null;
  return s.toUpperCase();
}

function normalizeStatementAmount_(value) {
  if (value === null || value === undefined || value === "") return null;
  let s = String(value).trim().replace(/^\s*(RM|MYR)\s*/i, "")
    .replace(/,/g, "").replace(/\s/g, "");
  // Reject negative, parenthesized, mixed-currency, and non-amount values.
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const number = Number(s);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

function getOrCreateInvoiceRegisterSheet_(spreadsheet) {
  const headers = [
    "Invoice Date", "Invoice No", "Amount (RM)",
    "Source Filename", "Time Added", "Model Used"
  ];
  let sheet = spreadsheet.getSheetByName(INVOICE_SHEET_NAME);
  if (sheet) {
    const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (actual.some(function(header, i) { return header !== headers[i]; })) {
      throw new Error('The existing "' + INVOICE_SHEET_NAME +
        '" tab has different headers. It was left unchanged to protect your data.');
    }
    return sheet;
  }

  sheet = spreadsheet.insertSheet(INVOICE_SHEET_NAME);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#0F766E")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.setTabColor("#0F766E");
  [138, 170, 145, 260, 165, 180].forEach(function(width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
  const bodyRows = Math.max(1, sheet.getMaxRows() - 1);
  sheet.getRange(2, 1, bodyRows, 1).setNumberFormat("dd/MM/yyyy");
  sheet.getRange(2, 2, bodyRows, 1).setNumberFormat("@");
  sheet.getRange(2, 3, bodyRows, 1).setNumberFormat('"RM"#,##0.00');
  sheet.getRange(2, 5, bodyRows, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();
  return sheet;
}

function statementInvoiceKey_(invoiceNo, invoiceDate, amount) {
  return invoiceNo + "|" + invoiceDate + "|" + Math.round(amount * 100);
}

function safeStatementSheetText_(value) {
  const s = String(value || "");
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/**
 * POST {action: "saveInvoices", results: extracted.results}
 * Creates and writes to Invoice Register ONLY; does not touch Sheet1.
 */
function handleSaveInvoiceRegister(data) {
  const results = data && (data.results || data.invoices);
  if (!Array.isArray(results) || !results.length) {
    throw new Error("No invoice rows supplied for saving.");
  }

  const lock = LockService.getDocumentLock() || LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error("No active Google Spreadsheet is available.");
    const sheet = getOrCreateInvoiceRegisterSheet_(spreadsheet);
    const tz = spreadsheet.getSpreadsheetTimeZone();
    const known = new Set();
    const existingCount = Math.max(0, sheet.getLastRow() - 1);
    if (existingCount) {
      sheet.getRange(2, 1, existingCount, 3).getValues().forEach(function(r) {
        const date = r[0] instanceof Date && !isNaN(r[0].getTime())
          ? Utilities.formatDate(r[0], tz, "dd/MM/yyyy")
          : normalizeStatementDate_(r[0]);
        const no = normalizeStatementInvoiceNo_(r[1]);
        const amt = normalizeStatementAmount_(r[2]);
        if (date && no && amt !== null) known.add(statementInvoiceKey_(no, date, amt));
      });
    }

    const rows = [];
    let duplicates = 0;
    let invalid = 0;
    results.forEach(function(item) {
      const no = normalizeStatementInvoiceNo_(item && item.invoiceNo);
      const date = normalizeStatementDate_(item && item.invoiceDate);
      const amt = normalizeStatementAmount_(item && item.amount);
      if (!no || !date || amt === null) { invalid++; return; }

      const key = statementInvoiceKey_(no, date, amt);
      if (known.has(key)) { duplicates++; return; }
      known.add(key);

      // Parse in the spreadsheet timezone so dates sort/filter as true dates.
      const sheetDate = Utilities.parseDate(date, tz, "dd/MM/yyyy");
      rows.push([
        sheetDate, no, amt,
        safeStatementSheetText_(item.fileName), new Date(),
        safeStatementSheetText_(item.modelUsed)
      ]);
    });

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
    }
    return {
      success: true,
      sheetName: INVOICE_SHEET_NAME,
      saved: rows.length,
      duplicatesSkipped: duplicates,
      invalidSkipped: invalid,
      message: "Saved to Invoice Register only. Sheet1 was not modified."
    };
  } finally {
    lock.releaseLock();
  }
}