import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { parse } from 'url';
import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/database';
let firebaseui = require('firebaseui');

declare var gapi : any;

const CLIENT_ID = '540806466980-i5mifkaf6utq2g8k3p3opbj6gd4jv9oj.apps.googleusercontent.com';
const DISCOVERY_DOCS = ["https://sheets.googleapis.com/$discovery/rest?version=v4"];

// Authorization scopes required by this component.
// Note we could specify multiple scopes here, separated by spaces.
const SCOPES = "https://www.googleapis.com/auth/spreadsheets.readonly";

const UNSELECTIVE_WORDS : Set<string> = new Set([
  "St.", "Saint", "St", "Church", "Orthodox", "Greek", "of", "the"
]);

class Spreadsheet {
  title : string;
  sheetTitle : string;
  table : Array<Array<number|string|null>>;

  // Maps from whole cell value to row index and then column index.
  valueIndex : Map<string|number, Map<number, Array<number>>>;
};

class ParishInfo {
  parishId : string;
  shortParishName : string;
  longParishName : string;
  shortRectorName : string;
  longRectorName : string;
  address : string;
  city : string;
  state : string;
  zip : string;
};

const PARISH_INFO_TO_DB : Map<string, string> = new Map([
  ['shortParishName', 'name'],
  ['longParishName', 'long_name'],
  ['address', 'address'],
  ['city', 'city'],
  ['state', 'state'],
  ['zip', 'zip'],
  ['shortRectorName', 'short_rector'],
  ['longRectorName', 'long_rector'],
]);

class ParishChange {
  oldValue : ParishInfo; 
  newValue : ParishInfo;
};

@Component({
  selector: 'app-parish-import',
  templateUrl: './parish-import.component.html',
  styleUrls: ['./parish-import.component.css']
})
export class ParishImportComponent implements OnInit {
  app : firebase.app.App;
  db : firebase.database.Database;
  parishIdRef : firebase.database.Reference;
  authUi : any;
  idRegex : RegExp = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/g;
  spreadsheet : Spreadsheet;
  proposedChanges : ParishChange[];
  newParishInfos : ParishInfo[];
  oldParishInfos : ParishInfo[];
  fields : string[];

  constructor(private ref: ChangeDetectorRef) { }

  ngOnInit() {
    console.log("ngOnInit");
    
    let config = {
      apiKey: "AIzaSyCnUOMJEjzdYiHsY4KIC47EPgSPIRDZjLY",
      authDomain: "intense-heat-7228.firebaseapp.com",
      databaseURL: "https://intense-heat-7228.firebaseio.com",
      storageBucket: "intense-heat-7228.appspot.com",
      messagingSenderId: "850593089657"
    };
    /*
    let config = {
      apiKey: "AIzaSyDneNgUkYqKBo0zuzqqket6tx705_O08Ug",
      authDomain: "easy-nmc-dev.firebaseapp.com",
      databaseURL: "https://easy-nmc-dev.firebaseio.com",
      storageBucket: "easy-nmc-dev.appspot.com",
      messagingSenderId: "27452413795"
    };*/
    this.app = firebase.initializeApp(config);
    this.db  = firebase.database();
    this.parishIdRef = this.db.ref("easy-nmc/metropolis/SF/parish-id");

    let uiConfig = {
      signInSuccessUrl: '/',
      signInOptions: [
        // Leave the lines as is for the providers you want to offer your users.
        firebase.auth.GoogleAuthProvider.PROVIDER_ID,
        firebase.auth.FacebookAuthProvider.PROVIDER_ID,
        firebase.auth.TwitterAuthProvider.PROVIDER_ID,
        firebase.auth.GithubAuthProvider.PROVIDER_ID,
        firebase.auth.EmailAuthProvider.PROVIDER_ID
      ],
      // Terms of service url.
      tosUrl: '/'
    };

    console.log("about to call firebaseui.auth.AuthUI");
    // Initialize the FirebaseUI Widget using Firebase.
    this.authUi = new firebaseui.auth.AuthUI(firebase.auth());
    // The start method will wait until the DOM is loaded.
    console.log("about to call ui.start");
    this.authUi.start('#firebaseui-auth-container', uiConfig);
    console.log("called ui.start");    
  }

  ngOnViewInit() {
    console.log("ngOnViewInit");
  }

  onAnalyzeSpreadsheet(url : string) {
    console.log("onAnalyzeSpreadsheet called", url);
    gapi.load('client:auth2', () => {
      gapi.client.init({
        discoveryDocs: DISCOVERY_DOCS,
        clientId: CLIENT_ID,
        scope: SCOPES
      }).then(() => {
        if (gapi.auth2.getAuthInstance().isSignedIn.get()) {
          this.analyzeSpreadsheet(url);
        } else {
          gapi.auth2.getAuthInstance().signIn().then(() => {
            this.analyzeSpreadsheet(url);
          }).catch((err) => {
            console.log("Sign in didn't happen", url);
          });
        }
      });
    });
  }

  onApproveAll() {
    console.log("onApproveAll called");
    let happy = false;
    this.parishIdRef.transaction(obj => {
      happy = this.applyChanges(this.proposedChanges, obj);
      return obj;
    }).then(result => {
      console.log("finished transaction", result, happy);
    }).catch(error => {
      console.log("transaction error", error, happy);
    });
  }

  analyzeSpreadsheet(url : string) {
    console.log("analyzeSpreadsheet called", url);
    let parsed = parse(url);
    console.log("path", parsed.path);
    let regexResult = this.idRegex.exec(parsed.path);
    if (!regexResult) {
      // Couldn't find spreadsheet ID from the path.
      // TODO: Present error to user.
      console.log("Couldn't find spreadsheet ID in path");
      return;
    }
    let spreadsheetId = regexResult[1];
    console.log("spreadsheetId", spreadsheetId);
    gapi.client.sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
      includeGridData: true,
    }).then((response) => {
      console.log('got response', response);
      this.spreadsheet = this.extractSpreadsheet(response.result);
      this.newParishInfos = this.spreadsheetToParishInfo(this.spreadsheet);
      this.parishIdRef.once('value').then((snap) => {
        console.log('got parish-id read', snap.val());
        this.oldParishInfos = this.databaseToParishInfo(snap.val());
        this.proposedChanges = this.proposeChanges(this.oldParishInfos, this.newParishInfos);
        this.fields = this.extractFields(this.oldParishInfos.concat(this.newParishInfos));
        this.ref.detectChanges();
      }).catch((error) => {
        console.log("unable to read parish-id object from Firebase", error);
      });
    }, (response) => {
      console.log("got error", response);
    });

  }

  extractFields(objs : any[]) : string[] {
    let set : Set<string> = new Set();
    for (let obj of objs) {
      for (let field of Object.keys(obj)) {
        set.add(field);
      }
    }
    let result = [];
    set.forEach(v => {
      result.push(v);
    })
    return result;
  }

  extractSpreadsheet(spreadsheetObj : any) : Spreadsheet {
    console.log("extractSpreadsheet", spreadsheetObj);
    let spreadsheet = new Spreadsheet();
    spreadsheet.title = spreadsheetObj.properties.title;
    let sheet = spreadsheetObj.sheets[0];
    spreadsheet.sheetTitle = sheet.properties.title;
    let data = sheet.data[0];
    spreadsheet.table = [];
    spreadsheet.valueIndex = new Map();
    for (let rowIndex = 0; rowIndex < data.rowData.length; rowIndex++) {
      let newRow = [];
      let row = data.rowData[rowIndex];
      for (let colIndex = 0; colIndex < row.values.length; colIndex++) {
        let valObj = row.values[colIndex].effectiveValue;
        if (!valObj) {
          continue;
        }
        let val : string|number|null;
        if (valObj.stringValue) {
          val = valObj.stringValue;
        } else if (typeof valObj.numberValue == "number") {
          val = valObj.numberValue;
        }
        newRow[colIndex] = val;
        if (val !== null) {
          let rowMap = spreadsheet.valueIndex.get(val);
          if (rowMap == undefined) {
            rowMap = new Map();
            spreadsheet.valueIndex.set(val, rowMap);
          }
          let colArray = rowMap.get(rowIndex);
          if (colArray == undefined) {
            colArray = new Array();
            rowMap.set(rowIndex, colArray);
          }
          colArray.push(colIndex);
        }
      }
      if (newRow.length > 0) {
        spreadsheet.table[rowIndex] = newRow;
      }
    }
    console.log("produced spreadsheet", spreadsheet);
    return spreadsheet;
  }

  spreadsheetToParishInfo(spreadsheet : Spreadsheet) : ParishInfo[] {
    let result = [];
    let longRectorNameIndex = 0;
    let longParishNameIndex = 1;
    let addressIndex = 5;
    let cityIndex = 7;
    let stateIndex = 8;
    let zipIndex = 9;
    // Here I'm deliberately skipping the first and last row as a hack to quickly
    // deal with the current spreadsheet.
    for (let rowIndex = 1; rowIndex < spreadsheet.table.length - 1; rowIndex++) {
      let row = spreadsheet.table[rowIndex];
      if (row.length < 6) {
        continue;
      }
      let parishInfo = new ParishInfo();
      parishInfo.address = String(row[addressIndex]);
      parishInfo.city = String(row[cityIndex]);
      parishInfo.longParishName = String(row[longParishNameIndex]);
      parishInfo.state = String(row[stateIndex]);
      parishInfo.longRectorName = String(row[longRectorNameIndex]);
      parishInfo.zip = String(row[zipIndex]);
      result.push(parishInfo);
    }
    return result;
  }

  databaseToParishInfo(parishInfoObj : any) : ParishInfo[] {
    let result = [];
    for (let parishId of Object.keys(parishInfoObj)) {
      let dbEntry = parishInfoObj[parishId];
      let parishInfo = this.dbEntryToParishInfo(dbEntry);
      parishInfo.parishId = parishId;
      result.push(parishInfo);
    }
    console.log("databaseToParishInfo result", result);
    return result;
  }

  dbEntryToParishInfo(dbEntry : any) : ParishInfo {
    let parishInfo = new ParishInfo();
    PARISH_INFO_TO_DB.forEach((db, pi) => {
      parishInfo[pi] = dbEntry[db];
    });
    return parishInfo;
  }

  applyChanges(changes : ParishChange[], parishIdObj : any) : boolean {
    if (!this.matchesOldValues(changes, parishIdObj)) {
      return false;
    }
    for (let change of changes) {
      let n = change.newValue;
      let v = parishIdObj[n.parishId];
      PARISH_INFO_TO_DB.forEach((db, pi) => {
        let tp = typeof n[pi];
        if (tp === "undefined") {
          return;
        } 
        v[db] = n[pi];
      });
    }
    return true;
  }

  matchesOldValues(changes : ParishChange[], parishIdObj : any) : boolean {
    if (!parishIdObj) {
      return false;
    }
    for (let change of changes) {
      let v = parishIdObj[change.newValue.parishId];
      if (!v) {
        // All parishes we're trying to change must already exist.
        return false;
      }
      let fieldsMatch = true;
      let o = change.oldValue;
      PARISH_INFO_TO_DB.forEach((db, pi) => {
        if (o[pi] !== v[db]) {
          fieldsMatch = false;
        }
      });
      if (!fieldsMatch) {
        return false;
      }
    }
    return true;
  }

  cityMap(parishes : ParishInfo[]) : Map<string, Array<number>> {
    let result = new Map<string, Array<number>>();
    for (let i = 0; i < parishes.length; i++) {
      let p = parishes[i];
      if (!p.city) {
        continue;
      }
      let l = result.get(p.city);
      if (!l) {
        l = [];
        result.set(p.city, l);
      }
      l.push(i);
    }
    return result;
  }

  selectiveWords(name : string) : Set<string> {
    let result = new Set();
    for (let word of name.split(" ")) {
      if (UNSELECTIVE_WORDS.has(word)) {
        continue;
      }
      result.add(word);
    }
    return result;
  }

  nameMatchStrength(nameA : string, nameB : string) : number {
    let result = 0;
    let wordsA = this.selectiveWords(nameA);
    let wordsB = this.selectiveWords(nameB);
    wordsA.forEach(wordA => {
      if (wordsB.has(wordA)) {
        result++;
      }
    });
    return result;
  }

  // Returns mapping from indexes of listA to listB.
  findPairings(listA : ParishInfo[], listB : ParishInfo[]) : Map<number, number> {
    let result = new Map<number, number>();
    let cm = this.cityMap(listB);
    for (let ai = 0; ai < listA.length; ai++) {
      let pa = listA[ai];
      if (!pa.city) {
        continue;
      }
      let potentialMatches = cm.get(pa.city);
      if (!potentialMatches) {
        continue;
      }
      if (potentialMatches.length == 1) {
        result.set(ai, potentialMatches[0]);
        continue;
      }
      let aName = pa.longParishName;
      if (!aName) {
        aName = pa.shortParishName;
      }
      if (!aName) {
        continue;
      }
      let ambiguous = false;
      let bestStrength = 0;
      let bestIndex = -1;
      for (let bi of potentialMatches) {
        let pb = listB[bi];
        let bName = pb.longParishName;
        if (!bName) {
          bName = pb.shortParishName;
        }
        let matchStrength = this.nameMatchStrength(aName, bName);
        if (matchStrength == 0 || matchStrength < bestStrength) {
          continue;
        }
        if (matchStrength > bestStrength) {
          bestStrength = matchStrength;
          bestIndex = bi;
          ambiguous = false;
          continue;
        }
        ambiguous = true;
      }
      if (bestStrength == 0) {
        console.log("no match", pa.city, aName);
        continue;
      }
      if (ambiguous) {
        console.log("ambiguous match", pa.city, aName);
        continue;
      }
      result.set(ai, bestIndex);
    }
    // Count of each index into listB that occurs in values of result.
    let counts : Map<number, number> = new Map();
    result.forEach((bi, ai) => {
      let c = counts.get(bi);
      if (!c) {
        c = 0;
      }
      c++;
      counts.set(bi, c);
    });
    let bsToRemove : Set<number> = new Set();
    counts.forEach((c, bi) => {
      if (c > 1) {
        bsToRemove.add(bi);
      }
    });
    let asToRemove : Set<number> = new Set();
    if (bsToRemove.size > 0) {
      result.forEach((bi, ai) => {
        if (bsToRemove.has(bi)) {
          asToRemove.add(ai);
        }
      });
    }
    asToRemove.forEach(ai => {
      result.delete(ai);
    });
    console.log("findPairings result", result);
    return result;
  }

  proposeChanges(oldParishInfos : ParishInfo[], newParishInfos : ParishInfo[]) : ParishChange[] {
    let result = [];
    let mappings = this.findPairings(oldParishInfos, newParishInfos);
    mappings.forEach((newi, oldi) => {
      let oldp = oldParishInfos[oldi];
      let newp = newParishInfos[newi];
      for (let field of Object.keys(oldp)) {
        if (typeof newp[field] === "undefined") {
          newp[field] = oldp[field];
          continue;
        }
      }
      let change = new ParishChange();
      change.oldValue = oldp;
      change.newValue = newp;
      result.push(change);
    });
    console.log("proposeChanges result", result);
    return result;
  }
}
