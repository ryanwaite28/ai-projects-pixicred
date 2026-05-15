import Handlebars from 'handlebars';
import applicationSubmittedTemplateSource from './templates/application-submitted.hbs';
import type { Application } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

const applicationSubmittedTemplate = Handlebars.compile(applicationSubmittedTemplateSource);

export function buildApplicationSubmittedEmail(application: Application, baseUrl: string): SendEmailInput {
  const htmlBody = applicationSubmittedTemplate({
    firstName: application.firstName,
    applicationId: application.applicationId,
    baseUrl,
  });

  return {
    to: application.email,
    subject: 'Your PixiCred Application Has Been Received',
    htmlBody,
    textBody: [
      `Dear ${application.firstName},`,
      '',
      'Thank you for applying for a PixiCred credit card. We have received your application and our team is currently reviewing it. You will hear from us shortly with a decision.',
      '',
      `Confirmation Code: ${application.applicationId}`,
      '',
      `Save your confirmation code — you can use it to check your application status at ${baseUrl}/apply/status`,
      '',
      'Sincerely,',
      'The PixiCred Team',
    ].join('\n'),
  };
}
