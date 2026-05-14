import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface SubmitApplicationInput {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  annualIncome: number;
  mockSsn: string;
}

export type ApplicationStatus = 'PENDING' | 'APPROVED' | 'DECLINED';

export interface ApplicationStatusResponse {
  applicationId: string;
  status: ApplicationStatus;
  firstName: string;
}

@Injectable({ providedIn: 'root' })
export class ApplicationService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  submitApplication(input: SubmitApplicationInput): Observable<{ applicationId: string }> {
    return this.http
      .post<{ data: { applicationId: string } }>(`${this.base}/applications`, input)
      .pipe(map((res) => res.data));
  }

  getApplicationStatus(applicationId: string): Observable<ApplicationStatusResponse> {
    return this.http
      .get<{ data: ApplicationStatusResponse }>(`${this.base}/applications/${applicationId}`)
      .pipe(map((res) => res.data));
  }
}
