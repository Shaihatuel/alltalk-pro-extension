// ============================================
// UNIVERSAL VANILLASOFT SCRAPER
// Works with multiple VanillaSoft layouts
// ============================================

// Lead change detection DISABLED - use refresh button in extension
// This prevents any interference with VanillaSoft's performance

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Clean phone number - remove +1 or leading 1 for 11 digit numbers
function cleanPhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    cleaned = cleaned.substring(1);
  }
  return cleaned;
}

// Check if a string looks like a phone number
function isPhoneNumber(text) {
  if (!text) return false;
  const cleaned = text.replace(/\D/g, '');
  return cleaned.length === 10 || (cleaned.length === 11 && cleaned.startsWith('1'));
}

// Check if a string looks like an email
function isEmail(text) {
  if (!text) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}

// Check if a string looks like a date (DOB)
function isDate(text) {
  if (!text) return false;
  // Matches: YYYY-MM-DD, MM/DD/YYYY, MM-DD-YYYY, etc.
  return /\d{4}-\d{2}-\d{2}|\d{2}[-\/]\d{2}[-\/]\d{4}/.test(text.trim());
}

// Extract state from text (2-letter state code)
function extractState(text) {
  if (!text) return '';
  const stateMatch = text.match(/\b([A-Z]{2})\b/);
  const validStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
  if (stateMatch && validStates.includes(stateMatch[1])) {
    return stateMatch[1];
  }
  return '';
}

// Extract zip code from text
function extractZip(text) {
  if (!text) return '';
  const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  return zipMatch ? zipMatch[1] : '';
}

// Get text content from an element, checking value first for inputs
function getElementText(el) {
  if (!el) return '';
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    return (el.value || el.getAttribute('data-previousvalue') || '').trim();
  }
  return (el.textContent || el.innerText || '').trim();
}

// Find element by ID (tries multiple possible IDs)
function findByIds(doc, ids) {
  for (const id of ids) {
    const el = doc.querySelector(id);
    if (el) {
      const text = getElementText(el);
      if (text) return text;
    }
  }
  return '';
}

// Find element by label text (looks for label then finds associated input/value)
function findByLabel(doc, labelTexts, cachedElements) {
  const allElements = cachedElements || doc.querySelectorAll('td, th, label, span, div');
  
  for (const labelText of labelTexts) {
    const lowerLabel = labelText.toLowerCase();
    
    for (const el of allElements) {
      const text = (el.textContent || '').toLowerCase().trim();
      
      // Check if this element contains the label
      if (text.includes(lowerLabel) || text === lowerLabel || text.startsWith(lowerLabel)) {
        // Look for value in next sibling
        let sibling = el.nextElementSibling;
        if (sibling) {
          const siblingText = getElementText(sibling);
          if (siblingText && siblingText.toLowerCase() !== lowerLabel) {
            return siblingText;
          }
        }
        
        // Look for input inside or nearby
        const input = el.querySelector('input, select, textarea') || 
                      el.parentElement?.querySelector('input, select, textarea');
        if (input) {
          const inputText = getElementText(input);
          if (inputText) return inputText;
        }
        
        // For table cells, check the next cell
        if (el.tagName === 'TD' || el.tagName === 'TH') {
          const nextCell = el.nextElementSibling;
          if (nextCell) {
            const cellText = getElementText(nextCell);
            if (cellText) return cellText;
          }
        }
        
        // Check parent's next sibling (common pattern)
        const parentSibling = el.parentElement?.nextElementSibling;
        if (parentSibling) {
          const psText = getElementText(parentSibling);
          if (psText && psText.toLowerCase() !== lowerLabel) {
            return psText;
          }
        }
      }
    }
  }
  return '';
}

// ============================================
// CONTACT NAME FINDER
// ============================================

// Validate that text looks like a real name, not a placeholder
function isValidName(text) {
  if (!text) return false;
  
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);
  
  // Must be 2-4 words
  if (words.length < 2 || words.length > 4) return false;
  
  // Length must be between 3 and 50
  if (trimmed.length < 3 || trimmed.length >= 50) return false;
  
  // Cannot contain @ or digits
  if (/@|\d/.test(trimmed)) return false;
  
  // Cannot start or end with dashes or multiple spaces
  if (/^[-\s]+|[-\s]+$/.test(trimmed)) return false;
  
  // Cannot contain placeholder or app/brand keywords
  const lowerText = trimmed.toLowerCase();
  const invalidKeywords = [
    'select', 'choose', 'filter', 'all projects', 'project', '--',
    'vanillasoft', 'alltalk', 'beta', 'pro', 'crm', 'extension',
    'app', 'version', 'loading', 'loading...', 'no data'
  ];
  for (const keyword of invalidKeywords) {
    if (lowerText.includes(keyword)) return false;
  }
  
  // Reject if any individual word is a known app/brand keyword
  const brandKeywords = ['vanillasoft', 'alltalk', 'beta', 'pro', 'crm'];
  for (const word of words) {
    if (brandKeywords.includes(word.toLowerCase())) return false;
  }
  
  return true;
}

function findContactName(doc, isIdLayout) {
  let firstName = '';
  let lastName = '';

  // Method 1: Try known IDs first (highest priority)
  firstName = findByIds(doc, ['#FirstName', '#first_name', '#firstName', '[name="FirstName"]', '[name="first_name"]']);
  lastName = findByIds(doc, ['#LastName', '#last_name', '#lastName', '[name="LastName"]', '[name="last_name"]']);

  if (firstName || lastName) {
    return { firstName, lastName };
  }

  // Method 2: Look for class-based selectors that indicate contact/lead name areas
  // These are more reliable than generic h1/h2/h3 tags
  const contactCardSelectors = [
    '.contact-name', '.lead-name', '.customer-name',
    '[class*="contact-name"]', '[class*="lead-name"]',
    '[id*="contact-name"]', '[id*="lead-name"]'
  ];

  for (const selector of contactCardSelectors) {
    const els = doc.querySelectorAll(selector);
    for (const el of els) {
      const text = getElementText(el);
      if (isValidName(text)) {
        const parts = text.trim().split(/\s+/);
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
        return { firstName, lastName };
      }
    }
  }

  // Method 3: Look in contact info/lead info panels with attribute selectors
  // Skipped on ID-based layouts — the [class*="contact"] substring walk is expensive
  // and unnecessary when #FirstName/#LastName would have already returned in Method 1
  if (!isIdLayout) {
  const panelSelectors = [
    '[class*="contact"]', '[class*="lead"]',
    '[id*="contact"]', '[id*="lead"]'
  ];

  for (const panelSelector of panelSelectors) {
    const panels = doc.querySelectorAll(panelSelector);
    for (const panel of panels) {
      // Within panel, look for form-like elements before headings
      const inputFields = panel.querySelectorAll('input[type="text"], div[contenteditable="true"]');
      for (const field of inputFields) {
        const text = getElementText(field);
        if (isValidName(text)) {
          const parts = text.trim().split(/\s+/);
          firstName = parts[0];
          lastName = parts.slice(1).join(' ');
          return { firstName, lastName };
        }
      }
      
      // Then try strong, b, or styled text within the panel
      const styledElements = panel.querySelectorAll('strong, b, [style*="font-weight"], [style*="font-size"]');
      for (const el of styledElements) {
        const text = getElementText(el);
        if (isValidName(text)) {
          const parts = text.trim().split(/\s+/);
          firstName = parts[0];
          lastName = parts.slice(1).join(' ');
          return { firstName, lastName };
        }
      }
    }
  }
  } // end !isIdLayout

  // Method 4: As a last resort, scan h1/h2/h3 tags (more likely to be page headers)
  const headerSelectors = ['h1', 'h2', 'h3'];
  for (const selector of headerSelectors) {
    const els = doc.querySelectorAll(selector);
    for (const el of els) {
      const text = getElementText(el);
      if (isValidName(text)) {
        const parts = text.trim().split(/\s+/);
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
        return { firstName, lastName };
      }
    }
  }
  
  return { firstName: '', lastName: '' };
}

// ============================================
// PHONE NUMBER FINDER
// ============================================

function findAllPhoneNumbers(doc) {
  const phoneNumbers = [];
  const seenNumbers = new Set();
  const excludedNumbers = new Set();
  
  // =============================================
  // STEP 1: BUILD EXCLUSION LIST - Only Contact ID
  // =============================================
  
  const allText = doc.body ? doc.body.textContent : '';
  
  // Only exclude the exact Contact ID number
  const contactIdMatch = allText.match(/Contact\s*ID[:\s]*(\d{7,11})/i);
  if (contactIdMatch) {
    excludedNumbers.add(contactIdMatch[1]);
    console.log('Excluded Contact ID:', contactIdMatch[1]);
  }
  
  // Find Contact ID by label
  doc.querySelectorAll('td, div, span, label').forEach(el => {
    const text = (el.textContent || '').trim().toLowerCase();
    if (text === 'contact id' || text === 'contactid' || text === 'lead id' || text === 'leadid') {
      const nextEl = el.nextElementSibling;
      if (nextEl) {
        const val = (nextEl.textContent || '').trim().replace(/\D/g, '');
        if (val.length >= 7 && val.length <= 11) {
          excludedNumbers.add(val);
          console.log('Excluded Contact ID (from label):', val);
        }
      }
    }
  });
  
  console.log('Excluded:', Array.from(excludedNumbers));
  
  // =============================================
  // STEP 2: ADD PHONE FUNCTION
  // =============================================
  
  function addPhone(number, label, source) {
    const cleaned = cleanPhoneNumber(number);
    const raw = number.replace(/\D/g, '');
    
    // Only exclude Contact ID
    if (excludedNumbers.has(cleaned) || excludedNumbers.has(raw) || excludedNumbers.has(raw.slice(-10))) {
      console.log('Rejected (Contact ID):', cleaned, source);
      return false;
    }
    
    if (cleaned.length === 10 && !seenNumbers.has(cleaned)) {
      seenNumbers.add(cleaned);
      phoneNumbers.push({ number: cleaned, label: label });
      console.log('✓ Found:', cleaned, label, 'via', source);
      return true;
    }
    return false;
  }
  
  // =============================================
  // STEP 3: TRY MULTIPLE DETECTION METHODS
  // =============================================
  
  // METHOD A: Direct ID selectors
  const idSelectors = ['#n2807139', '#Phone', '#PrimaryPhone', '#HomePhone', '#MobilePhone', '#CellPhone'];
  for (const sel of idSelectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const val = el.value || el.textContent || '';
      if (isPhoneNumber(val)) {
        addPhone(val, 'Primary', 'ID selector');
      }
    }
  }
  
  // If Method A found phone(s) via ID selectors, skip expensive DOM scans (Methods B–E)
  if (phoneNumbers.length > 0) {
    console.log('Final result:', phoneNumbers);
    return phoneNumbers;
  }

  // METHOD B: Scan page for phone patterns near known labels using regex
  // Note: VanillaSoft sometimes formats as "348- 4484" (dash + space), so use [-.\s]{0,2}
  const phoneRegex = '[1]?\\s*\\(?\\d{3}\\)?[-.\\ ]{0,2}\\d{3}[-.\\ ]{0,2}\\d{4}';
  const labelPatterns = [
    { regex: new RegExp('Primary\\s*Phone[\\s\\n]*(' + phoneRegex + ')', 'i'), label: 'Primary' },
    { regex: new RegExp('Home\\s*Phone[\\s\\n]*(' + phoneRegex + ')', 'i'), label: 'Alt' },
    { regex: new RegExp('Home[\\s\\n]+(' + phoneRegex + ')', 'i'), label: 'Alt' },
    { regex: new RegExp('Mobile\\s*Phone[\\s\\n]*(' + phoneRegex + ')', 'i'), label: 'Alt' },
    { regex: new RegExp('Cell\\s*Phone[\\s\\n]*(' + phoneRegex + ')', 'i'), label: 'Alt' },
    { regex: new RegExp('Work\\s*Phone[\\s\\n]*(' + phoneRegex + ')', 'i'), label: 'Alt' },
    { regex: new RegExp('Best\\s*Phone[\\s\\n]*(' + phoneRegex + ')', 'i'), label: 'Alt' },
    { regex: new RegExp('Another\\s*Phone[\\s\\n]*(' + phoneRegex + ')', 'i'), label: 'Alt' },
    { regex: new RegExp('Other\\s*Phone[\\s\\n]*(' + phoneRegex + ')', 'i'), label: 'Alt' },
    { regex: new RegExp('Alt\\s*Phone[\\s\\n]*(' + phoneRegex + ')', 'i'), label: 'Alt' },
    { regex: /phone:\s*(\d{10,11})\s*confidence:/gi, label: 'Alt' },
  ];
  
  // Relaxed phone extractor for matched text (handles "348- 4484" format)
  const extractPhoneFromMatch = (text) => {
    const m = text.match(/\d{10,11}|\(?\d{3}\)?[-.\s]{0,2}\d{3}[-.\s]{0,2}\d{4}/);
    return m ? m[0] : null;
  };
  
  for (const { regex, label } of labelPatterns) {
    const matches = allText.match(regex);
    if (matches) {
      const phoneMatch = extractPhoneFromMatch(matches[0]);
      if (phoneMatch) {
        addPhone(phoneMatch, phoneNumbers.length === 0 ? 'Primary' : label, 'regex pattern');
      }
    }
  }
  
  // METHOD C: Find elements with phone-related text and scan nearby
  const phoneKeywords = ['primary phone', 'home phone', 'mobile', 'cell phone', 'work phone', 'best phone', 'another phone', 'alt phone', 'other phone'];
  doc.querySelectorAll('td, div, span, label, th').forEach(el => {
    const text = (el.textContent || '').toLowerCase().trim();
    
    // Skip elements that are part of "Other Phone Numbers From People Search" or similar non-contact fields
    if (text.includes('people search') || text.includes('script tab') || text.includes('other phone numbers from')) return;
    
    for (const keyword of phoneKeywords) {
      if (text === keyword || text.startsWith(keyword + '\n') || text.startsWith(keyword + ' ')) {
        const parent = el.parentElement;
        if (parent) {
          const parentText = parent.textContent || '';
          if (parentText.toLowerCase().includes('people search') || parentText.toLowerCase().includes('script tab')) continue;
          const phoneMatch = parentText.match(/[1]?\s*\(?\d{3}\)?[-.\s]{0,2}\d{3}[-.\s]{0,2}\d{4}/);
          if (phoneMatch && isPhoneNumber(phoneMatch[0])) {
            let lbl = keyword.includes('primary') ? 'Primary' : 'Alt';
            addPhone(phoneMatch[0], phoneNumbers.length === 0 ? 'Primary' : lbl, 'keyword search');
          }
        }
        
        const sib = el.nextElementSibling;
        if (sib) {
          const sibText = sib.textContent || '';
          const sibPhone = sibText.match(/[1]?\s*\(?\d{3}\)?[-.\s]{0,2}\d{3}[-.\s]{0,2}\d{4}/);
          if (sibPhone && isPhoneNumber(sibPhone[0])) {
            addPhone(sibPhone[0], phoneNumbers.length === 0 ? 'Primary' : 'Alt', 'sibling search');
          }
        }
      }
    }
  });
  
  // METHOD D: Find standalone phone numbers (leaf elements with just a phone)
  // Only accept if parent has a phone-related label
  doc.querySelectorAll('div, span, td').forEach(el => {
    if (el.children.length === 0) {
      const text = (el.textContent || '').trim();
      if (text.match(/^[1]?\s*\(?\d{3}\)?[-.\s]{0,2}\d{3}[-.\s]{0,2}\d{4}$/)) {
        const parentText = (el.parentElement?.textContent || '').toLowerCase();
        
        // Skip People Search, Script Tab, and other non-contact fields
        if (parentText.includes('people search') || parentText.includes('script tab') || 
            parentText.includes('other phone numbers from')) return;
        
        // MUST have a phone-related label
        const hasPhoneLabel = parentText.includes('phone') || 
                             (parentText.includes('home') && !parentText.includes('homepage')) ||
                             parentText.includes('mobile') || parentText.includes('cell') ||
                             parentText.includes('work') || parentText.includes('best') ||
                             parentText.includes('primary') || parentText.includes('another');
        
        // Skip if in SMS area or no phone label
        const inSmsArea = parentText.includes('send from') || parentText.includes('delivered') ||
                         parentText.includes('michael') || parentText.includes('devin') ||
                         parentText.includes('noah') || parentText.includes('agent') ||
                         parentText.includes('pm ') || parentText.includes('am ');
        
        if (hasPhoneLabel && !inSmsArea) {
          let lbl = parentText.includes('primary') ? 'Primary' : 'Alt';
          addPhone(text, phoneNumbers.length === 0 ? 'Primary' : lbl, 'standalone element');
        }
      }
    }
  });
  
  // METHOD E: Find tel: links - but only if near phone-related content
  doc.querySelectorAll('a[href^="tel:"]').forEach(a => {
    const phone = a.href.replace('tel:', '').replace(/\D/g, '');
    const parentText = (a.parentElement?.textContent || '').toLowerCase();
    
    // Only accept if parent has phone-related label
    const hasPhoneLabel = parentText.includes('phone') || parentText.includes('home') ||
                         parentText.includes('mobile') || parentText.includes('cell') ||
                         parentText.includes('primary');
    
    // Skip if in SMS area or People Search
    const inSmsArea = parentText.includes('delivered') || parentText.includes('send from') ||
                     parentText.includes('michael') || parentText.includes('devin') ||
                     parentText.includes('people search') || parentText.includes('script tab');
    
    if (hasPhoneLabel && !inSmsArea) {
      addPhone(phone, phoneNumbers.length === 0 ? 'Primary' : 'Alt', 'tel link');
    }
  });
  
  // METHOD F: Only scan if we found NO phones from Methods A-E
  // And require a phone label to be nearby
  if (phoneNumbers.length === 0) {
    console.log('No phones found from methods A-E, trying broad scan...');
    
    const allPhones = allText.match(/[1]?\s*\(?\d{3}\)?[-.\s]{0,2}\d{3}[-.\s]{0,2}\d{4}/g) || [];
    
    for (const phone of allPhones) {
      const cleaned = cleanPhoneNumber(phone);
      if (!excludedNumbers.has(cleaned) && !seenNumbers.has(cleaned)) {
        const idx = allText.indexOf(phone);
        const contextBefore = allText.substring(Math.max(0, idx - 80), idx).toLowerCase();
        
        // MUST have a phone-related label before it
        const hasPhoneLabel = contextBefore.includes('phone') || contextBefore.includes('home\n') || 
                             contextBefore.includes('home ') || contextBefore.includes('mobile') || 
                             contextBefore.includes('cell') || contextBefore.includes('work') || 
                             contextBefore.includes('best') || contextBefore.includes('primary');
        
        if (!hasPhoneLabel) {
          console.log('Skipping - no phone label:', cleaned);
          continue;
        }
        
        // Skip People Search / Script Tab fields
        if (contextBefore.includes('people search') || contextBefore.includes('script tab') ||
            contextBefore.includes('other phone numbers from')) {
          console.log('Skipping - People Search field:', cleaned);
          continue;
        }
        
        // Skip if near SMS-related words
        const contextAfter = allText.substring(idx, Math.min(allText.length, idx + 50)).toLowerCase();
        if (contextBefore.includes('delivered') || contextAfter.includes('delivered') ||
            contextBefore.includes('send from') || contextAfter.includes('send from') ||
            contextBefore.includes('michael') || contextBefore.includes('devin') ||
            contextBefore.includes('noah') || contextBefore.includes('agent')) {
          console.log('Skipping - SMS context:', cleaned);
          continue;
        }
        
        let lbl = contextBefore.includes('primary') ? 'Primary' : 'Alt';
        addPhone(phone, lbl, 'broad scan');
        
        if (phoneNumbers.length >= 3) break;
      }
    }
  }
  
  console.log('Final result:', phoneNumbers);
  return phoneNumbers;
}

// ============================================
// EMAIL FINDER
// ============================================

function findEmail(doc, cachedElements) {
  // Method 1: Try known IDs
  const email = findByIds(doc, [
    '#Email', '#email', '#EmailAddress', '#email_address',
    '[name="Email"]', '[name="email"]', '[name="EmailAddress"]',
    '[type="email"]'
  ]);
  if (isEmail(email)) return email;

  // Method 2: Find by label
  const emailByLabel = findByLabel(doc, ['Email', 'E-mail', 'Email Address'], cachedElements);
  if (isEmail(emailByLabel)) return emailByLabel;
  
  // Method 3: Scan for email patterns in the contact area
  const contactArea = doc.querySelector('.contact-info, .lead-info, [class*="contact"]') || doc.body;
  const allText = contactArea.querySelectorAll('td, div, span, a');
  
  for (const el of allText) {
    const text = getElementText(el);
    if (isEmail(text)) {
      return text;
    }
    // Check href for mailto:
    if (el.tagName === 'A' && el.href && el.href.startsWith('mailto:')) {
      return el.href.replace('mailto:', '');
    }
  }
  
  return '';
}

// ============================================
// DOB FINDER
// ============================================

function findDOB(doc, cachedElements) {
  // Method 1: Try known IDs
  const dob = findByIds(doc, [
    '#n2807164', // Known ID from first layout
    '#DOB', '#dob', '#DateOfBirth', '#date_of_birth', '#BirthDate', '#birth_date',
    '#InsuredDOB', '#insured_dob',
    '[name="DOB"]', '[name="dob"]', '[name="DateOfBirth"]', '[name="BirthDate"]'
  ]);
  if (isDate(dob)) return dob;

  // Method 2: Find by label - prioritize "Insured DOB" first
  const priorityLabels = ['Insured DOB', 'DOB', 'Date of Birth', 'Birth Date', 'Birthday', 'Birthdate'];
  for (const label of priorityLabels) {
    const dobByLabel = findByLabel(doc, [label], cachedElements);
    if (isDate(dobByLabel)) return dobByLabel;
  }
  
  // Method 3: Look for date patterns near DOB-related text
  // But EXCLUDE "Added on", "Added", "Created", etc.
  const allCells = doc.querySelectorAll('td, div, span');
  for (const cell of allCells) {
    const text = (cell.textContent || '').toLowerCase();
    
    // Skip if this is an "added on" or creation date field
    if (text.includes('added') || text.includes('created') || text.includes('joined') || 
        text.includes('registered') || text.includes('contact\'s time')) {
      continue;
    }
    
    if (text.includes('dob') || text.includes('birth') || text.includes('insured dob')) {
      // Look for date in this cell or next sibling
      const dateMatch = text.match(/\d{4}-\d{2}-\d{2}|\d{2}[-\/]\d{2}[-\/]\d{4}/);
      if (dateMatch) return dateMatch[0];
      
      const sibling = cell.nextElementSibling;
      if (sibling) {
        const siblingText = getElementText(sibling);
        if (isDate(siblingText)) return siblingText;
      }
    }
  }
  
  return '';
}

// ============================================
// ADDRESS/ZIP/STATE FINDER
// ============================================

function findAddressInfo(doc, cachedElements) {
  let zipCode = '';
  let state = '';

  // Method 1: Try known IDs
  zipCode = findByIds(doc, [
    '#ZipCode', '#zip_code', '#Zip', '#zip', '#PostalCode', '#postal_code',
    '[name="ZipCode"]', '[name="Zip"]', '[name="PostalCode"]'
  ]);

  state = findByIds(doc, [
    '#State', '#state', '#Province', '#province',
    '[name="State"]', '[name="state"]'
  ]);

  if (zipCode && state) {
    return { zipCode: extractZip(zipCode) || zipCode, state: extractState(state) || state };
  }

  // Method 2: Find by label
  if (!zipCode) {
    zipCode = findByLabel(doc, ['Zip', 'Zip Code', 'Postal Code', 'ZIP'], cachedElements);
  }
  if (!state) {
    state = findByLabel(doc, ['State', 'Province', 'ST'], cachedElements);
  }
  
  // Method 3: Parse from address block
  // Look for address pattern: City, ST XXXXX
  const addressElements = doc.querySelectorAll('td, div, span, address');
  for (const el of addressElements) {
    const text = getElementText(el);
    // Pattern: City, ST 12345 or City ST 12345
    const addressMatch = text.match(/([A-Za-z\s]+),?\s+([A-Z]{2})\s+(\d{5})/);
    if (addressMatch) {
      if (!state) state = addressMatch[2];
      if (!zipCode) zipCode = addressMatch[3];
      break;
    }
  }
  
  return { 
    zipCode: extractZip(zipCode) || zipCode, 
    state: extractState(state) || state 
  };
}

// ============================================
// MAIN SCRAPE FUNCTION
// ============================================

function scrapeContactFromDocument(doc) {
  console.log("Scraping contact from document...");

  // Quick layout probe — if known ID fields exist, this is an ID-based layout (fast path)
  const isIdLayout = !!doc.querySelector('#FirstName, #LastName, #Phone, #n2807139, #PrimaryPhone, #HomePhone, #MobilePhone, #CellPhone');

  // Compute once and share across all findByLabel calls inside findEmail, findDOB, findAddressInfo
  const labelElements = doc.querySelectorAll('td, th, label, span, div');

  const nameData = findContactName(doc, isIdLayout);
  const phoneNumbers = findAllPhoneNumbers(doc);
  const addressInfo = findAddressInfo(doc, labelElements);

  const contact = {
    firstName: nameData.firstName,
    lastName: nameData.lastName,
    phone: phoneNumbers.length > 0 ? phoneNumbers[0].number : '',
    email: findEmail(doc, labelElements),
    dob: findDOB(doc, labelElements),
    zipCode: addressInfo.zipCode,
    state: addressInfo.state
  };
  
  console.log("Scraped contact:", contact);
  console.log("Phone numbers found:", phoneNumbers);
  
  return { contact, phoneNumbers };
}

// Check if this document has contact data
function hasContactData(doc) {
  // Check for common VanillaSoft elements
  const hasKnownIds = doc.querySelector('#FirstName, #LastName, #Phone, #Email, [class*="contact"], [class*="lead"]');
  if (hasKnownIds) return true;
  
  // Check if there's a name-like element
  const nameData = findContactName(doc);
  if (nameData.firstName || nameData.lastName) return true;
  
  // Check for phone numbers
  const phones = findAllPhoneNumbers(doc);
  if (phones.length > 0) return true;
  
  return false;
}

// ============================================
// MESSAGE LISTENERS
// ============================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SCRAPE_CONTACT") {
    
    // First, check if THIS document has the contact fields
    if (hasContactData(document)) {
      console.log("Found contact data in current document:", window.location.href);
      const { contact, phoneNumbers } = scrapeContactFromDocument(document);
      
      const hasData = contact.firstName || contact.lastName || contact.phone || contact.email;
      if (hasData) {
        sendResponse({ ok: true, contact: contact, phoneNumbers: phoneNumbers });
        return true;
      }
    }
    
    // If we're in the top frame, check iframes
    if (window === window.top) {
      console.log("Checking iframes from top frame...");
      const iframes = document.querySelectorAll('iframe');
      
      for (let i = 0; i < iframes.length; i++) {
        try {
          const iframeDoc = iframes[i].contentDocument || iframes[i].contentWindow?.document;
          if (iframeDoc && hasContactData(iframeDoc)) {
            console.log("Found contact data in iframe:", i, iframes[i].src);
            const { contact, phoneNumbers } = scrapeContactFromDocument(iframeDoc);
            
            const hasData = contact.firstName || contact.lastName || contact.phone || contact.email;
            if (hasData) {
              sendResponse({ ok: true, contact: contact, phoneNumbers: phoneNumbers });
              return true;
            }
          }
        } catch (e) {
          console.log("Could not access iframe", i, e.message);
        }
      }
    }
    
    // If we're in an iframe but don't have data, don't respond
    if (window !== window.top && !hasContactData(document)) {
      console.log("No contact data in this iframe, not responding");
      return false;
    }
    
    // Only send failure response from top frame if nothing found
    if (window === window.top) {
      console.log("No contact data found in any frame");
      sendResponse({ ok: false, error: "No contact data found", phoneNumbers: [] });
    }
    
    return true;
  }
  
  return false;
});

// Listen for AllTalk button request
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SHOW_ALLTALK_BUTTON" && msg.contactId) {
    if (window !== window.top) return false;
    
    const existingBtn = document.getElementById("alltalk-open-btn");
    if (existingBtn) existingBtn.remove();
    
    const btn = document.createElement("button");
    btn.id = "alltalk-open-btn";
    btn.textContent = "🔗 Open in AllTalk Pro";
    btn.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 999999;
      padding: 12px 20px;
      background: #7066e7;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    
    btn.addEventListener("click", () => {
      window.open(`https://app.alltalkpro.com/contacts/${msg.contactId}`, "_blank");
    });
    
    btn.addEventListener("mouseover", () => {
      btn.style.background = "#5d54d4";
    });
    
    btn.addEventListener("mouseout", () => {
      btn.style.background = "#7066e7";
    });
    
    document.body.appendChild(btn);
    sendResponse({ ok: true });
  }
  
  // Quick contact name check for polling
  if (msg.type === "GET_CONTACT_NAME") {
    const nameData = findContactName(document);
    
    if (nameData.firstName || nameData.lastName) {
      const name = (nameData.firstName || '') + '|' + (nameData.lastName || '');
      sendResponse({
        ok: true, 
        name: name
      });
      return true;
    }
    
    // Check iframes if we're in top frame
    if (window === window.top) {
      const iframes = document.querySelectorAll('iframe');
      for (let i = 0; i < iframes.length; i++) {
        try {
          const doc = iframes[i].contentDocument || iframes[i].contentWindow?.document;
          if (doc) {
            const iframeNameData = findContactName(doc);
            if (iframeNameData.firstName || iframeNameData.lastName) {
              const name = (iframeNameData.firstName || '') + '|' + (iframeNameData.lastName || '');
              console.log("GET_CONTACT_NAME responding from iframe with:", name);
              sendResponse({ 
                ok: true, 
                name: name
              });
              return true;
            }
          }
        } catch (e) {}
      }
      // Only top frame sends failure response
      sendResponse({ ok: false });
    }
    return true;
  }
});

