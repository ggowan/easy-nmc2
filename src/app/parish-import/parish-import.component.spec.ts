/* tslint:disable:no-unused-variable */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';

import { ParishImportComponent } from './parish-import.component';

describe('ParishImportComponent', () => {
  let component: ParishImportComponent;
  let fixture: ComponentFixture<ParishImportComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ParishImportComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ParishImportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
