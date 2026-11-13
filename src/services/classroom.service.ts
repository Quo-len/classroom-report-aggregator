import { google, classroom_v1 } from 'googleapis';
import { AuthService } from './auth.service';
import { env } from '../config/env';

export interface CourseAssignment {
  id: string;
  title: string;
  creationDate: Date;
  creationDateFormatted: string;
  deadline: Date | null;
  deadlineFormatted: string;
  daysRemaining: number | null;
  raw: classroom_v1.Schema$CourseWork;
}

export interface StudentSubmissionItem {
  submissionId: string;
  userId: string;
  studentName: string;
  studentEmail: string;
  state: string; // 'TURNED_IN' | 'NEW' | 'CREATED' | 'RECLAIMED_BY_STUDENT' | 'RETURNED'
  hasSubmitted: boolean;
  updateTime?: string;
  attachments: {
    id?: string;
    title?: string;
    alternateLink?: string;
    mimeType?: string;
    driveFile?: classroom_v1.Schema$DriveFile;
  }[];
}

export class ClassroomService {
  private static classroomApi: classroom_v1.Classroom | null = null;

  private static async getClient(): Promise<classroom_v1.Classroom> {
    if (!this.classroomApi) {
      const auth = await AuthService.getAuthClient();
      this.classroomApi = google.classroom({ version: 'v1', auth });
    }
    return this.classroomApi;
  }

  /**
   * Find the targeted assignment by name and extract its metadata and deadline
   */
  public static async getTargetAssignment(): Promise<CourseAssignment | null> {
    const classroom = await this.getClient();
    console.log(`🔍 Polling Google Classroom course [${env.CLASSROOM_COURSE_ID}] for assignment: "${env.ASSIGNMENT_NAME}"...`);

    try {
      const res = await classroom.courses.courseWork.list({
        courseId: env.CLASSROOM_COURSE_ID,
        courseWorkStates: ['PUBLISHED'],
        pageSize: 100,
      });

      const items = res.data.courseWork || [];
      const match = items.find(
        (work) => work.title?.trim().toLowerCase() === env.ASSIGNMENT_NAME.trim().toLowerCase()
      );

      if (!match || !match.id) {
        console.warn(`⚠️ Assignment "${env.ASSIGNMENT_NAME}" not found in course ${env.CLASSROOM_COURSE_ID}. Available assignments:`,
          items.map((i) => i.title).join(', ') || 'None'
        );
        return null;
      }

      const creationDate = match.creationTime ? new Date(match.creationTime) : new Date();
      let deadline: Date | null = null;
      let daysRemaining: number | null = null;

      if (match.dueDate) {
        const year = match.dueDate.year || new Date().getFullYear();
        const month = (match.dueDate.month || 1) - 1;
        const day = match.dueDate.day || 1;
        const hours = match.dueTime?.hours ?? 23;
        const minutes = match.dueTime?.minutes ?? 59;
        const seconds = match.dueTime?.seconds ?? 59;

        deadline = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
        const now = new Date();
        const diffMs = deadline.getTime() - now.getTime();
        daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      }

      const result: CourseAssignment = {
        id: match.id,
        title: match.title || env.ASSIGNMENT_NAME,
        creationDate,
        creationDateFormatted: creationDate.toLocaleDateString('uk-UA', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        deadline,
        deadlineFormatted: deadline
          ? deadline.toLocaleDateString('uk-UA', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Не встановлено',
        daysRemaining,
        raw: match,
      };

      console.log(`✅ Found assignment: "${result.title}" (ID: ${result.id})`);
      console.log(`   📅 Created on: ${result.creationDateFormatted}`);
      console.log(`   ⏰ Deadline: ${result.deadlineFormatted} (${result.daysRemaining !== null ? result.daysRemaining + ' days left' : 'no deadline'})`);

      return result;
    } catch (error) {
      console.error(`❌ Failed to list assignments from Classroom course ${env.CLASSROOM_COURSE_ID}:`, error);
      throw error;
    }
  }

  /**
   * Fetches all registered teachers/students in the course
   */
  public static async getCourseStudents(): Promise<Map<string, { name: string; email: string }>> {
    const classroom = await this.getClient();
    const studentsMap = new Map<string, { name: string; email: string }>();

    try {
      console.log(`👥 Fetching roster students for course [${env.CLASSROOM_COURSE_ID}]...`);
      let pageToken: string | undefined = undefined;

      do {
        const res: classroom_v1.Schema$ListStudentsResponse = (
          await classroom.courses.students.list({
            courseId: env.CLASSROOM_COURSE_ID,
            pageSize: 100,
            pageToken,
          })
        ).data;

        if (res.students) {
          for (const s of res.students) {
            if (s.userId) {
              const name = s.profile?.name?.fullName || 'Невідомий викладач';
              const email = s.profile?.emailAddress || '';
              studentsMap.set(s.userId, { name, email });
            }
          }
        }
        pageToken = res.nextPageToken || undefined;
      } while (pageToken);

      console.log(`👥 Total teachers/students enrolled in course: ${studentsMap.size}`);
      return studentsMap;
    } catch (error) {
      console.error(`❌ Failed to fetch course students for course ${env.CLASSROOM_COURSE_ID}:`, error);
      return studentsMap;
    }
  }

  /**
   * Fetches all submissions for an assignment with submitted attachments
   */
  public static async getSubmissions(courseWorkId: string): Promise<StudentSubmissionItem[]> {
    const classroom = await this.getClient();
    const studentsMap = await this.getCourseStudents();
    const submissions: StudentSubmissionItem[] = [];

    try {
      console.log(`📥 Fetching student submissions for assignment ID: ${courseWorkId}...`);
      let pageToken: string | undefined = undefined;

      do {
        const res: classroom_v1.Schema$ListStudentSubmissionsResponse = (
          await classroom.courses.courseWork.studentSubmissions.list({
            courseId: env.CLASSROOM_COURSE_ID,
            courseWorkId,
            pageSize: 100,
            pageToken,
          })
        ).data;

        if (res.studentSubmissions) {
          for (const sub of res.studentSubmissions) {
            const userId = sub.userId || 'unknown';
            const studentInfo = studentsMap.get(userId) || {
              name: `Користувач ID: ${userId}`,
              email: '',
            };

            const state = sub.state || 'NEW';
            // Submissions are considered turned in if state is TURNED_IN or RETURNED
            const hasSubmitted = state === 'TURNED_IN' || state === 'RETURNED';

            const attachments: StudentSubmissionItem['attachments'] = [];
            const materials = sub.assignmentSubmission?.attachments || [];

            for (const mat of materials) {
              if (mat.driveFile) {
                attachments.push({
                  id: mat.driveFile.id || undefined,
                  title: mat.driveFile.title || undefined,
                  alternateLink: mat.driveFile.alternateLink || undefined,
                  mimeType: undefined, // Will be resolved if needed
                  driveFile: mat.driveFile,
                });
              }
            }

            submissions.push({
              submissionId: sub.id || '',
              userId,
              studentName: studentInfo.name,
              studentEmail: studentInfo.email,
              state,
              hasSubmitted,
              updateTime: sub.updateTime || undefined,
              attachments,
            });
          }
        }

        pageToken = res.nextPageToken || undefined;
      } while (pageToken);

      // Also cross check if any enrolled student doesn't have a submission record yet
      for (const [userId, info] of studentsMap.entries()) {
        const alreadyListed = submissions.some((s) => s.userId === userId);
        if (!alreadyListed) {
          submissions.push({
            submissionId: '',
            userId,
            studentName: info.name,
            studentEmail: info.email,
            state: 'NEW',
            hasSubmitted: false,
            attachments: [],
          });
        }
      }

      const submittedCount = submissions.filter((s) => s.hasSubmitted).length;
      console.log(`📊 Total teachers evaluated: ${submissions.length} (${submittedCount} submitted, ${submissions.length - submittedCount} pending)`);
      return submissions;
    } catch (error) {
      console.error(`❌ Failed to retrieve submissions for courseWork ${courseWorkId}:`, error);
      throw error;
    }
  }
}
